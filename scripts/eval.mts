// Runs the full rewrite pipeline over the eval passages and records the
// scores, so you can see whether quality is going up over time.
//
//   npm run eval                     # Best quality, all passages
//   npm run eval -- --quality fast --limit 4 --label "after prompt tweak"

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { config } from "@/lib/config";
import { evalRequest, loadEvalPassages, mapLimit } from "@/lib/evalset";
import { runPipeline } from "@/lib/pipeline";
import { activeGuide, saveEvalRun } from "@/lib/store";

const { values } = parseArgs({
  options: {
    quality: { type: "string", default: "best" },
    limit: { type: "string" },
    label: { type: "string" },
    concurrency: { type: "string", default: "3" },
  },
});

const quality = values.quality === "fast" ? "fast" : "best";
const passages = loadEvalPassages().slice(0, values.limit ? Number(values.limit) : undefined);
const guide = activeGuide();

console.log(
  `Eval: ${passages.length} passages, ${quality} quality, models fast=${config.fastModel} best=${config.bestModel} judge=${config.judgeModel}, guide v${guide?.version ?? 0}\n`,
);

const rows = await mapLimit(passages, Number(values.concurrency), async (passage) => {
  const started = Date.now();
  const result = await runPipeline(evalRequest(passage, quality), { persist: false });
  const s = result.scores;
  console.log(
    `${passage.id.padEnd(26)} overall ${s ? s.overall.toFixed(2) : "  -  "}  nat ${s?.naturalness ?? "-"}  meaning ${s?.meaning ?? "-"}  (${((Date.now() - started) / 1000).toFixed(1)}s)`,
  );
  return { id: passage.id, mode: passage.mode, input: passage.text, output: result.output, scores: s };
});

const scored = rows.filter((r) => r.scores);
const mean = scored.reduce((sum, r) => sum + (r.scores?.overall ?? 0), 0) / Math.max(1, scored.length);
const label = values.label ?? `${quality} eval`;
saveEvalRun({ label, guideVersion: guide?.version ?? null, meanScore: mean, results: rows });

const dir = path.join(process.cwd(), "eval", "results");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(file, JSON.stringify({ label, quality, config, guideVersion: guide?.version ?? null, mean, rows }, null, 2));

console.log(`\nMean overall: ${mean.toFixed(2)} / 10  (saved ${path.relative(process.cwd(), file)})`);
