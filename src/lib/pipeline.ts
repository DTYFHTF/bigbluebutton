import { ContextOverflowError, chunkText, estimateTokens, joinChunks, promptTokens, type Chunk } from "./budget";
import { cleanOutput } from "./cleanup";
import { config, runSetup } from "./config";
import { builtinExemplars } from "./exemplars";
import { pickExamples } from "./examples";
import { bestScored, issueNotes, judge, type Judgement } from "./judge";
import { streamText } from "./llm";
import { copiedSentences, lexicalChange, missingNumbers, sentencesReworked } from "./metrics";
import { NEAR_COPY_FLOOR, SYNONYM_TARGETS, type ModeId } from "./modes";
import {
  REFINE_INSTRUCTIONS,
  buildRefineMessage,
  buildSystemPrompt,
  buildUserMessage,
  exampleTurns,
  maxTokensFor,
  missingFrozenTerms,
  taskReminder,
  varietyNudge,
  type ParaphraseRequest,
} from "./prompt";
import { activeGuide, learnedPhrases, saveRun, type Scores } from "./store";
import { countWords } from "./text";

export type Stage = "writing" | "drafting" | "judging" | "refining" | "checking" | "reworking";

export interface RewriteMetrics {
  // Share of the output's words that are new (word order ignored).
  lexicalChange: number;
  // Share of output sentences that aren't near-copies of an input sentence.
  sentencesReworked: number;
}

export type PipelineEvent =
  | { type: "stage"; stage: Stage; message: string }
  | { type: "delta"; text: string }
  | { type: "reset" }
  | {
      type: "result";
      runId: string | null;
      output: string;
      scores: Scores | null;
      metrics: RewriteMetrics;
      detail: string;
    };

// Each "Best" draft gets a different approach, so the judge has genuinely
// different options to choose between.
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
  metrics: RewriteMetrics;
  detail: string;
}

export interface DraftOptions {
  model: string;
  effort: typeof config.bestEffort;
  guideRules: string[];
  angle?: string;
  useExamples?: boolean;
  // Extra instruction for a retry (e.g. varietyNudge()).
  nudge?: string;
  // Sampling seed (OpenAI-compatible providers only); defaults to HUMANLY_SEED.
  seed?: number;
  onDelta?: (t: string) => void;
  signal?: AbortSignal;
}

// Output size relative to input, by mode.
function outputFactor(mode: ModeId): number {
  return mode === "expand" ? 2 : mode === "shorten" ? 0.7 : 1.2;
}

export function measure(input: string, output: string): RewriteMetrics {
  return { lexicalChange: lexicalChange(input, output), sentencesReworked: sentencesReworked(input, output) };
}

export async function draftOnce(req: ParaphraseRequest, opts: DraftOptions): Promise<string> {
  const profile = config.promptProfile;
  const system = buildSystemPrompt(req, { guideRules: opts.guideRules, angle: opts.angle, profile });
  const reminder = taskReminder(req) + (opts.nudge ? ` ${opts.nudge}` : "");
  const approved = opts.useExamples === false ? [] : pickExamples(req.mode, req.text);
  // Small models get examples as chat turns: the user's own approved rewrites
  // when there are any, otherwise built-in demonstrations.
  const turns =
    profile === "compact" ? exampleTurns((approved.length > 0 ? approved : builtinExemplars(req.mode)).slice(0, 2)) : [];
  const inline = profile === "compact" ? [] : approved;

  const call = (text: string, withExamples: boolean, onDelta?: (t: string) => void) =>
    streamText(
      {
        model: opts.model,
        effort: opts.effort,
        role: "draft",
        seed: opts.seed,
        maxTokens: maxTokensFor(countWords(text)),
        minOutputTokens: Math.ceil(estimateTokens(text) * outputFactor(req.mode)) + 32,
        system,
        history: withExamples ? turns : [],
        user: buildUserMessage(text, withExamples ? inline : [], reminder),
      },
      { onDelta, signal: opts.signal },
    );

  // Budget checks run before anything is sent, so an overflow never leaves
  // half-streamed text behind.
  try {
    return cleanOutput(req.text, await call(req.text, true, opts.onDelta));
  } catch (error) {
    if (!(error instanceof ContextOverflowError)) throw error;
  }
  if (turns.length > 0 || inline.length > 0) {
    try {
      return cleanOutput(req.text, await call(req.text, false, opts.onDelta));
    } catch (error) {
      if (!(error instanceof ContextOverflowError)) throw error;
    }
  }

  // Still too long for the context window: rewrite paragraph by paragraph
  // (or sentence run by sentence run), each piece with the full instructions.
  const fixed = promptTokens({ system, user: buildUserMessage("", [], reminder) });
  const room = config.main.numCtx - fixed - 160;
  const maxChunk = Math.max(60, Math.floor(room / (1 + outputFactor(req.mode))));
  const rewritten: Chunk[] = [];
  for (const chunk of chunkText(req.text, maxChunk)) {
    if (chunk.separator) opts.onDelta?.(chunk.separator);
    rewritten.push({ separator: chunk.separator, text: cleanOutput(chunk.text, await call(chunk.text, false, opts.onDelta)) });
  }
  return joinChunks(rewritten);
}

// True when `candidate` drops a frozen term or a number that `current` kept.
function losesProtected(req: ParaphraseRequest, current: string, candidate: string): boolean {
  return (
    missingFrozenTerms(req.text, candidate, req.frozen).length > missingFrozenTerms(req.text, current, req.frozen).length ||
    missingNumbers(req.text, candidate).length > missingNumbers(req.text, current).length
  );
}

// When a draft barely changed the wording (a common small-model failure: it
// "rewrites" by copying), ask again once with a firmer instruction. A retry is
// kept only if it copies fewer of the input's sentences, stays within the
// mode's expected length and the slider's range, and keeps every number and
// frozen term the draft kept. A failed retry never costs the finished draft.
export async function ensureVariety(
  req: ParaphraseRequest,
  draft: string,
  redraft: (nudge: string) => Promise<string>,
  onRetry: () => void,
  signal?: AbortSignal,
): Promise<{ text: string; retried: boolean }> {
  // Fluency should change little, and Shorten works by deleting words, so
  // a low share of new vocabulary is expected in both.
  if (req.mode === "fluency" || req.mode === "shorten" || config.nearCopyRetries === 0) {
    return { text: draft, retried: false };
  }
  const floor = NEAR_COPY_FLOOR[req.synonyms] ?? NEAR_COPY_FLOOR[3];
  const ceiling = Math.min(1, 2 * (SYNONYM_TARGETS[req.synonyms] ?? SYNONYM_TARGETS[3]) + 0.1);
  const [minRatio, maxRatio] = req.mode === "expand" ? [1, 3.5] : [0.75, 1.35];
  const inputWords = Math.max(1, countWords(req.text));

  let best = draft;
  let bestChange = lexicalChange(req.text, draft);
  let bestCopied = copiedSentences(req.text, draft);
  for (let i = 0; i < config.nearCopyRetries && (bestChange < floor || !best.trim()); i++) {
    onRetry();
    let candidate: string;
    try {
      candidate = await redraft(varietyNudge(req.synonyms));
    } catch (error) {
      if (signal?.aborted) throw error;
      console.error("variety retry failed; keeping the first draft", error);
      break;
    }
    if (!candidate.trim()) continue;
    const change = lexicalChange(req.text, candidate);
    const copied = copiedSentences(req.text, candidate);
    const ratio = countWords(candidate) / inputWords;
    const improves = !best.trim() || (change > bestChange && (copied < bestCopied || bestCopied === 0));
    if (improves && change <= ceiling && ratio >= minRatio && ratio <= maxRatio && !losesProtected(req, best, candidate)) {
      best = candidate;
      bestChange = change;
      bestCopied = copied;
    }
  }
  return { text: best, retried: best !== draft };
}

async function tryJudge(
  req: ParaphraseRequest,
  candidates: string[],
  signal: AbortSignal | undefined,
  extraPhrases: ReturnType<typeof learnedPhrases>,
): Promise<Judgement[] | null> {
  try {
    return await judge(req, req.text, candidates, { signal, extraPhrases });
  } catch (error) {
    if (signal?.aborted) throw error;
    console.error("scoring failed", error);
    return null;
  }
}

export async function runPipeline(req: ParaphraseRequest, opts: PipelineOptions = {}): Promise<PipelineResult> {
  const emit = opts.emit ?? (() => {});
  const { signal } = opts;
  const guide = opts.guideRules === undefined ? activeGuide() : null;
  const guideRules = opts.guideRules ?? guide?.rules ?? [];
  const extraPhrases = learnedPhrases();
  const reworking = () => emit({ type: "stage", stage: "reworking", message: "Reworking for more variety…" });

  let output: string;
  let scores: Scores | null = null;
  let detail: string;
  let model: string;

  if (req.quality === "fast") {
    model = config.fastModel;
    const base: DraftOptions = { model, effort: config.fastEffort, guideRules, useExamples: opts.useExamples, signal };
    emit({ type: "stage", stage: "writing", message: "Writing…" });
    const first = await draftOnce(req, { ...base, onDelta: (text) => emit({ type: "delta", text }) });
    const varied = await ensureVariety(req, first, (nudge) => draftOnce(req, { ...base, nudge }), reworking, signal);
    if (varied.retried) {
      emit({ type: "reset" });
      emit({ type: "delta", text: varied.text });
    }
    output = varied.text;
    emit({ type: "stage", stage: "checking", message: "Scoring…" });
    scores = (await tryJudge(req, [output], signal, extraPhrases))?.[0]?.scores ?? null;
    detail = varied.retried ? "Single pass, reworked once for more variety" : "Single pass";
  } else {
    model = config.bestModel;
    const base: DraftOptions = { model, effort: config.bestEffort, guideRules, useExamples: opts.useExamples, signal };
    const angles = ANGLES.slice(0, config.candidates);
    emit({
      type: "stage",
      stage: "drafting",
      message: angles.length > 1 ? `Writing ${angles.length} drafts…` : "Writing a draft…",
    });
    let finished = 0;
    const settled = await Promise.allSettled(
      angles.map((angle) =>
        draftOnce(req, { ...base, angle: angles.length > 1 ? angle : undefined }).then((text) => {
          emit({ type: "stage", stage: "drafting", message: `Draft ${++finished} of ${angles.length} done…` });
          return text;
        }),
      ),
    );
    const drafts = [...new Set(settled.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : [])))];
    if (drafts.length === 0) {
      const failure = settled.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      throw failure?.reason ?? new Error("No drafts were produced.");
    }

    emit({ type: "stage", stage: "judging", message: drafts.length > 1 ? "Comparing drafts…" : "Reviewing the draft…" });
    const judgements = await tryJudge(req, drafts, signal, extraPhrases);
    const bestIndex = bestScored(judgements) ?? 0;
    let bestDraft = drafts[bestIndex];
    let bestJudgement: Judgement | null = judgements?.[bestIndex] ?? null;
    let picked = drafts.length > 1 ? `Best of ${drafts.length} drafts` : "One draft";

    const varied = await ensureVariety(req, bestDraft, (nudge) => draftOnce(req, { ...base, nudge }), reworking, signal);
    if (varied.retried) {
      // The retry must hold up against the draft the judge picked: about the
      // same overall and no real loss of meaning. A judge that can't compare
      // them leaves the judged draft in place.
      const pair = await tryJudge(req, [bestDraft, varied.text], signal, extraPhrases);
      const kept = pair?.[0]?.scores;
      const retry = pair?.[1]?.scores;
      if (kept && retry && retry.meaning >= kept.meaning - 1 && retry.overall >= kept.overall - 0.3) {
        bestDraft = varied.text;
        bestJudgement = pair![1];
        picked += ", reworked for variety";
      } else if (kept) {
        bestJudgement = pair![0];
      }
    }

    if (!bestJudgement?.scores) {
      // Without scores there are no notes to polish against and no way to
      // check a polish, so the draft ships as it is.
      emit({ type: "delta", text: bestDraft });
      output = bestDraft;
      detail = `${picked}; scoring unavailable, so no polish`;
    } else if (bestJudgement.scores.overall >= SKIP_REFINE_SCORE && bestJudgement.issues.length === 0) {
      emit({ type: "delta", text: bestDraft });
      output = bestDraft;
      scores = bestJudgement.scores;
      detail = `${picked}, no polish needed`;
    } else {
      emit({ type: "stage", stage: "refining", message: "Polishing the best draft…" });
      // The polish is optional: if it fails for any reason other than the
      // user stopping, the judged draft ships.
      const polish: { failure: "overflow" | "failed" | null } = { failure: null };
      const refined = cleanOutput(
        req.text,
        await streamText(
          {
            model,
            effort: config.bestEffort,
            role: "draft",
            maxTokens: maxTokensFor(countWords(req.text)),
            minOutputTokens: Math.ceil(estimateTokens(bestDraft) * 1.1) + 32,
            system: `${buildSystemPrompt(req, { guideRules, profile: config.promptProfile })}\n\n${REFINE_INSTRUCTIONS}`,
            user: buildRefineMessage(req.text, bestDraft, issueNotes(bestJudgement.issues)),
          },
          { onDelta: (text) => emit({ type: "delta", text }), signal },
        ).catch((error) => {
          if (signal?.aborted) throw error;
          polish.failure = error instanceof ContextOverflowError ? "overflow" : "failed";
          if (polish.failure === "failed") console.error("polish failed; keeping the draft", error);
          return "";
        }),
      );

      // The polish only ships if it doesn't score below the draft it started from.
      emit({ type: "stage", stage: "checking", message: "Final check…" });
      const checks = refined ? await tryJudge(req, [bestDraft, refined], signal, extraPhrases) : null;
      const draftScore = checks?.[0]?.scores ?? null;
      const refinedScore = checks?.[1]?.scores ?? null;
      if (!refined) {
        emit({ type: "reset" });
        emit({ type: "delta", text: bestDraft });
        output = bestDraft;
        scores = bestJudgement.scores;
        detail =
          polish.failure === "overflow"
            ? `${picked}; too long to polish in the model's context window`
            : polish.failure === "failed"
              ? `${picked}; the polish failed, kept the draft`
              : `${picked}; the polish came back empty, kept the draft`;
      } else if (!draftScore || !refinedScore) {
        output = refined;
        scores = refinedScore;
        detail = `${picked}, polished (final check unavailable)`;
      } else if (refinedScore.overall + 0.05 >= draftScore.overall) {
        output = refined;
        scores = refinedScore;
        detail = `${picked}, polished`;
      } else {
        emit({ type: "reset" });
        emit({ type: "delta", text: bestDraft });
        output = bestDraft;
        scores = draftScore;
        detail = `${picked}; kept the draft because the polish scored lower`;
      }
    }
  }

  const metrics = measure(req.text, output);
  let runId: string | null = null;
  if (opts.persist !== false) {
    runId = crypto.randomUUID();
    saveRun({
      id: runId,
      createdAt: Date.now(),
      mode: req.mode,
      quality: req.quality,
      options: {
        synonyms: req.synonyms,
        dialect: req.dialect,
        frozen: req.frozen,
        customTone: req.customTone,
        setup: runSetup(model),
        metrics,
      },
      input: req.text,
      output,
      scores,
      guideVersion: guide?.version ?? null,
    });
  }

  emit({ type: "result", runId, output, scores, metrics, detail });
  return { runId, output, scores, metrics, detail };
}
