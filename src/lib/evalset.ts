import fs from "node:fs";
import path from "node:path";
import type { ModeId } from "./modes";
import { paraphraseRequestSchema, type ParaphraseRequest, type Quality } from "./prompt";

export interface EvalPassage {
  id: string;
  genre: string;
  mode: ModeId;
  text: string;
}

export function loadEvalPassages(): EvalPassage[] {
  const file = path.join(process.cwd(), "eval", "passages.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as EvalPassage[];
}

export function evalRequest(passage: EvalPassage, quality: Quality): ParaphraseRequest {
  return paraphraseRequestSchema.parse({ text: passage.text, mode: passage.mode, quality });
}

// A rotating slice so successive learning rounds are checked on different
// passages, which makes it harder for the guide to overfit to a few of them.
export function rotatingSlice<T>(items: T[], size: number, seed: number): T[] {
  if (items.length <= size) return items;
  const start = seed % items.length;
  return Array.from({ length: size }, (_, i) => items[(start + i) % items.length]);
}

// Runs async work over items with a cap on concurrency.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
