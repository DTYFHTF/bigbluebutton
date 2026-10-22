// Runs the rewrite pipeline over the eval passages and records quality scores
// and change metrics, so you can see whether changes actually help.
//
//   npm run eval                                   # Best quality, all passages, slider 3
//   npm run eval -- --quality fast --limit 4 --label "after prompt tweak"
//   npm run eval -- --quality fast --synonyms all  # sweep the synonym slider 1-5
//   npm run eval -- --ids long-ev-blog --repeat 3  # how noisy are the scores?
//   npm run eval -- --compare eval/competitor/other-tool-s3.json [--judge-compare]
//
// --compare reads a JSON array of {"id": "<passage id>", "text": "<rewrite>"}
// (for example outputs you saved by hand from another paraphraser) and
// reports the same metrics for them next to the passage, so the writing
// itself can be compared like for like. --judge-compare also scores them
// with the configured judge; --skip-ours measures only the file. For reproducible runs set HUMANLY_SEED=1 and
// put the judge on a strong model (HUMANLY_JUDGE_PROVIDER).

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { findAiPhrases } from "@/lib/aiisms";
import { config, runSetup } from "@/lib/config";
import { evalRequest, loadEvalPassages, mapLimit, type EvalPassage } from "@/lib/evalset";
import { judge } from "@/lib/judge";
import { missingNumbers } from "@/lib/metrics";
import { measure, runPipeline } from "@/lib/pipeline";
import { missingFrozenTerms } from "@/lib/prompt";
import type { Scores } from "@/lib/store";
import { activeGuide, saveEvalRun } from "@/lib/store";
import { countWords, sentenceRhythm } from "@/lib/text";

const { values } = parseArgs({
  options: {
    quality: { type: "string", default: "best" },
    limit: { type: "string" },
    ids: { type: "string" },
    label: { type: "string" },
    concurrency: { type: "string", default: "3" },
    synonyms: { type: "string", default: "3" },
    repeat: { type: "string", default: "1" },
    compare: { type: "string" },
    "judge-compare": { type: "boolean", default: false },
    "skip-ours": { type: "boolean", default: false },
  },
});

const quality = values.quality === "fast" ? "fast" : "best";
const levels = values.synonyms === "all" ? [1, 2, 3, 4, 5] : [Math.min(5, Math.max(1, Number(values.synonyms) || 3))];
const repeat = Math.max(1, Number(values.repeat) || 1);
let passages = loadEvalPassages();
if (values.ids) {
  const wanted = new Set(values.ids.split(",").map((s) => s.trim()));
  passages = passages.filter((p) => wanted.has(p.id));
}
const compareEntries = values.compare
  ? (JSON.parse(fs.readFileSync(path.resolve(values.compare), "utf8")) as Array<{ id: string; text: string; synonyms?: number }>)
  : [];
// With --compare, run on the same passages the comparison file covers.
if (values.compare && !values.ids) {
  const covered = new Set(compareEntries.map((e) => e.id));
  passages = passages.filter((p) => covered.has(p.id));
}
if (values.limit) passages = passages.slice(0, Number(values.limit));
const guide = activeGuide();

interface Row {
  id: string;
  mode: string;
  synonyms: number;
  attempt: number;
  input: string;
  output: string;
  scores: Scores | null;
  lexicalChange: number;
  sentencesReworked: number;
  roboticPhrases: number;
  rhythmStdev: number;
  missingNumbers: string[];
  missingFrozen: string[];
  seconds: number;
  detail: string;
}

function describe(passage: EvalPassage, output: string) {
  const m = measure(passage.text, output);
  return {
    lexicalChange: m.lexicalChange,
    sentencesReworked: m.sentencesReworked,
    roboticPhrases: findAiPhrases(output).length,
    rhythmStdev: sentenceRhythm(output).stdev,
    missingNumbers: missingNumbers(passage.text, output),
    missingFrozen: missingFrozenTerms(passage.text, output, passage.frozen ?? []),
  };
}

const pct = (n: number) => `${Math.round(n * 100)}%`.padStart(4);
function printRow(r: Row, tag = "") {
  const s = r.scores;
  const flags = [
    r.missingNumbers.length ? `missing numbers: ${r.missingNumbers.join(", ")}` : "",
    r.missingFrozen.length ? `missing frozen: ${r.missingFrozen.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  console.log(
    `${(tag + r.id).padEnd(30)} s${r.synonyms} ${s ? `overall ${s.overall.toFixed(2)} nat ${s.naturalness} mean ${s.meaning}` : "unscored".padEnd(26)}` +
      `  vocab ${pct(r.lexicalChange)} reworked ${pct(r.sentencesReworked)} stock ${r.roboticPhrases}` +
      `${r.seconds ? `  ${r.seconds.toFixed(1)}s` : ""}${flags ? `  !! ${flags}` : ""}`,
  );
}

function summarize(rows: Row[], label: string) {
  const scored = rows.filter((r) => r.scores);
  const avg = (f: (r: Row) => number, list = rows) => (list.length ? list.reduce((s, r) => s + f(r), 0) / list.length : NaN);
  console.log(
    `\n${label}: ${rows.length} rewrites, ${scored.length} scored` +
      `\n  mean overall ${avg((r) => r.scores!.overall, scored).toFixed(2)}  naturalness ${avg((r) => r.scores!.naturalness, scored).toFixed(2)}  meaning ${avg((r) => r.scores!.meaning, scored).toFixed(2)}` +
      `\n  mean new vocabulary ${pct(avg((r) => r.lexicalChange))}  sentences reworked ${pct(avg((r) => r.sentencesReworked))}  stock phrases ${avg((r) => r.roboticPhrases).toFixed(2)}` +
      `\n  rewrites missing numbers ${rows.filter((r) => r.missingNumbers.length).length}  missing frozen terms ${rows.filter((r) => r.missingFrozen.length).length}`,
  );
  if (levels.length > 1) {
    for (const level of levels) {
      const at = rows.filter((r) => r.synonyms === level);
      console.log(`  slider ${level}: new vocabulary ${pct(avg((r) => r.lexicalChange, at))}, meaning ${avg((r) => r.scores?.meaning ?? NaN, at.filter((r) => r.scores)).toFixed(2)}`);
    }
  }
  return scored.length ? avg((r) => r.scores!.overall, scored) : 0;
}

const setup = runSetup(quality === "fast" ? config.fastModel : config.bestModel);
console.log(
  `Eval: ${passages.length} passages x slider ${levels.join(",")} x ${repeat}, ${quality} quality\n` +
    `  provider ${setup.provider} model ${setup.model} prompt ${setup.promptProfile}; judge ${setup.judgeProvider} ${setup.judgeModel}` +
    `${setup.judgeProvider === setup.provider && setup.judgeModel === setup.model ? " (same model judging itself: scores are optimistic)" : ""}` +
    `; seed ${config.seed ?? "random"}; guide v${guide?.version ?? 0}\n`,
);

let mean = 0;
let rows: Row[] = [];
let competitor: Row[] = [];

if (values.compare) {
  // Score saved outputs from elsewhere with the same metrics.
  const file = path.resolve(values.compare);
  const entries = compareEntries;
  const byId = new Map(loadEvalPassages().map((p) => [p.id, p]));
  competitor = await mapLimit(entries, Number(values.concurrency), async (entry) => {
    const passage = byId.get(entry.id);
    if (!passage) throw new Error(`Unknown passage id in ${file}: ${entry.id}`);
    let scores: Scores | null = null;
    if (values["judge-compare"]) {
      const req = evalRequest(passage, quality, entry.synonyms ?? levels[0]);
      scores = (await judge(req, passage.text, [entry.text]).catch(() => null))?.[0]?.scores ?? null;
    }
    const row: Row = {
      id: passage.id,
      mode: passage.mode,
      synonyms: entry.synonyms ?? levels[0],
      attempt: 0,
      input: passage.text,
      output: entry.text,
      scores,
      seconds: 0,
      detail: "compare",
      ...describe(passage, entry.text),
    };
    printRow(row, "[compare] ");
    return row;
  });
  summarize(competitor, `Comparison file ${path.basename(file)}`);
  console.log("");
}

if (!values["skip-ours"]) {
  const jobs = passages.flatMap((passage) =>
    levels.flatMap((synonyms) => Array.from({ length: repeat }, (_, attempt) => ({ passage, synonyms, attempt }))),
  );
  rows = await mapLimit(jobs, Number(values.concurrency), async ({ passage, synonyms, attempt }) => {
    const started = Date.now();
    const result = await runPipeline(evalRequest(passage, quality, synonyms), { persist: false });
    const row: Row = {
      id: passage.id,
      mode: passage.mode,
      synonyms,
      attempt,
      input: passage.text,
      output: result.output,
      scores: result.scores,
      seconds: (Date.now() - started) / 1000,
      detail: result.detail,
      ...describe(passage, result.output),
    };
    printRow(row, repeat > 1 ? `#${attempt + 1} ` : "");
    return row;
  });
  mean = summarize(rows, "Humanly");

  if (repeat > 1) {
    // Run-to-run spread per passage: differences smaller than this are noise.
    const spreads = passages.map((p) => {
      const scores = rows.filter((r) => r.id === p.id && r.scores).map((r) => r.scores!.overall);
      return scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0;
    });
    console.log(`  run-to-run spread in overall score: up to ${Math.max(...spreads).toFixed(2)}`);
  }
}

const label = values.label ?? `${quality} eval${values.compare ? " + compare" : ""}`;
if (rows.length) saveEvalRun({ label, guideVersion: guide?.version ?? null, meanScore: mean, results: { setup, rows } });

const dir = path.join(process.cwd(), "eval", "results");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(
  file,
  JSON.stringify({ label, quality, levels, repeat, setup, guideVersion: guide?.version ?? null, mean, rows, competitor }, null, 2),
);
console.log(`\nSaved ${path.relative(process.cwd(), file)} (inputs, outputs and metrics for every row)`);
console.log(`Average words in: ${Math.round(passages.reduce((s, p) => s + countWords(p.text), 0) / Math.max(1, passages.length))}`);
