import { config } from "./config";
import { streamText } from "./llm";
import { pickExamples } from "./examples";
import { issueNotes, judge, type Judgement } from "./judge";
import {
  REFINE_INSTRUCTIONS,
  buildRefineMessage,
  buildSystemPrompt,
  buildUserMessage,
  maxTokensFor,
  type ParaphraseRequest,
} from "./prompt";
import { activeGuide, learnedPhrases, saveRun, type Scores } from "./store";
import { countWords } from "./text";

export type Stage = "writing" | "drafting" | "judging" | "refining" | "checking";

export type PipelineEvent =
  | { type: "stage"; stage: Stage; message: string }
  | { type: "delta"; text: string }
  | { type: "reset" }
  | { type: "result"; runId: string | null; output: string; scores: Scores | null; detail: string };

// Each "Best" draft gets a different approach, so the judge has genuinely
// different options to choose between (sampling temperature isn't available).
export const ANGLES = [
  "Approach for this draft: keep the original's paragraph and sentence order, and put the effort into wording and rhythm.",
  "Approach for this draft: restructure freely. Merge, split and reorder sentences wherever it makes the passage read better.",
  "Approach for this draft: imagine the author explaining this out loud to a sharp colleague, then tidy that into written prose in the right register.",
  "Approach for this draft: be economical. Cut every word that isn't pulling its weight while keeping all the content.",
  "Approach for this draft: aim for the most precise, concrete wording the original allows.",
];

// A draft good enough that polishing it is unlikely to help.
const SKIP_REFINE_SCORE = 9.2;

export interface PipelineOptions {
  emit?: (event: PipelineEvent) => void;
  signal?: AbortSignal;
  // Overrides the active style guide (used by the learner to A/B guides).
  guideRules?: string[];
  useExamples?: boolean;
  persist?: boolean;
}

export interface PipelineResult {
  runId: string | null;
  output: string;
  scores: Scores | null;
}

export async function draftOnce(
  req: ParaphraseRequest,
  opts: { model: string; effort: typeof config.bestEffort; guideRules: string[]; angle?: string; useExamples?: boolean; onDelta?: (t: string) => void; signal?: AbortSignal },
): Promise<string> {
  const examples = opts.useExamples === false ? [] : pickExamples(req.mode, req.text);
  return streamText(
    {
      model: opts.model,
      effort: opts.effort,
      maxTokens: maxTokensFor(countWords(req.text)),
      system: buildSystemPrompt(req, { guideRules: opts.guideRules, angle: opts.angle }),
      user: buildUserMessage(req.text, examples),
    },
    { onDelta: opts.onDelta, signal: opts.signal },
  );
}

export async function runPipeline(req: ParaphraseRequest, opts: PipelineOptions = {}): Promise<PipelineResult> {
  const emit = opts.emit ?? (() => {});
  const { signal } = opts;
  const guide = opts.guideRules === undefined ? activeGuide() : null;
  const guideRules = opts.guideRules ?? guide?.rules ?? [];
  const extraPhrases = learnedPhrases();

  let output: string;
  let scores: Scores | null = null;
  let detail: string;

  if (req.quality === "fast") {
    emit({ type: "stage", stage: "writing", message: "Writing…" });
    output = await draftOnce(req, {
      model: config.fastModel,
      effort: config.fastEffort,
      guideRules,
      useExamples: opts.useExamples,
      onDelta: (text) => emit({ type: "delta", text }),
      signal,
    });
    emit({ type: "stage", stage: "checking", message: "Scoring…" });
    try {
      [{ scores }] = await judge(req, req.text, [output], { signal, extraPhrases });
    } catch (error) {
      if (signal?.aborted) throw error;
      console.error("scoring failed", error);
    }
    detail = "Single pass";
  } else {
    const angles = ANGLES.slice(0, config.candidates);
    emit({
      type: "stage",
      stage: "drafting",
      message: angles.length > 1 ? `Writing ${angles.length} drafts…` : "Writing a draft…",
    });
    let finished = 0;
    const settled = await Promise.allSettled(
      angles.map((angle) =>
        draftOnce(req, {
          model: config.bestModel,
          effort: config.bestEffort,
          guideRules,
          angle: angles.length > 1 ? angle : undefined,
          useExamples: opts.useExamples,
          signal,
        }).then((text) => {
          emit({ type: "stage", stage: "drafting", message: `Draft ${++finished} of ${angles.length} done…` });
          return text;
        }),
      ),
    );
    const drafts = [
      ...new Set(settled.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []))),
    ];
    if (drafts.length === 0) {
      const failure = settled.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      throw failure?.reason ?? new Error("No drafts were produced.");
    }

    emit({ type: "stage", stage: "judging", message: drafts.length > 1 ? "Comparing drafts…" : "Reviewing the draft…" });
    const judgements = await judge(req, req.text, drafts, { signal, extraPhrases });
    const bestIndex = judgements.reduce((best, j, i) => (j.scores.overall > judgements[best].scores.overall ? i : best), 0);
    const bestDraft = drafts[bestIndex];
    const bestJudgement: Judgement = judgements[bestIndex];
    const picked = drafts.length > 1 ? `Best of ${drafts.length} drafts` : "One draft";

    if (bestJudgement.scores.overall >= SKIP_REFINE_SCORE && bestJudgement.issues.length === 0) {
      emit({ type: "delta", text: bestDraft });
      output = bestDraft;
      scores = bestJudgement.scores;
      detail = `${picked}, no polish needed`;
    } else {
      emit({ type: "stage", stage: "refining", message: "Polishing the best draft…" });
      const refined = await streamText(
        {
          model: config.bestModel,
          effort: config.bestEffort,
          maxTokens: maxTokensFor(countWords(req.text)),
          system: `${buildSystemPrompt(req, { guideRules })}\n\n${REFINE_INSTRUCTIONS}`,
          user: buildRefineMessage(req.text, bestDraft, issueNotes(bestJudgement.issues)),
        },
        { onDelta: (text) => emit({ type: "delta", text }), signal },
      );

      // The polish only ships if it doesn't score below the draft it started from.
      emit({ type: "stage", stage: "checking", message: "Final check…" });
      let checks: Judgement[] | null = null;
      try {
        checks = await judge(req, req.text, [bestDraft, refined], { signal, extraPhrases });
      } catch (error) {
        if (signal?.aborted) throw error;
        console.error("final check failed", error);
      }
      if (!checks) {
        output = refined || bestDraft;
        scores = null;
        detail = `${picked}, polished (final check unavailable)`;
      } else if (refined && checks[1].scores.overall + 0.05 >= checks[0].scores.overall) {
        output = refined;
        scores = checks[1].scores;
        detail = `${picked}, polished`;
      } else {
        emit({ type: "reset" });
        emit({ type: "delta", text: bestDraft });
        output = bestDraft;
        scores = checks[0].scores;
        detail = `${picked}; kept the draft because the polish scored lower`;
      }
    }
  }

  let runId: string | null = null;
  if (opts.persist !== false) {
    runId = crypto.randomUUID();
    saveRun({
      id: runId,
      createdAt: Date.now(),
      mode: req.mode,
      quality: req.quality,
      options: { synonyms: req.synonyms, dialect: req.dialect, frozen: req.frozen, customTone: req.customTone },
      input: req.text,
      output,
      scores,
      guideVersion: guide?.version ?? null,
    });
  }

  emit({ type: "result", runId, output, scores, detail });
  return { runId, output, scores };
}
