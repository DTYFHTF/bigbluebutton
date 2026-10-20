import type { ModeId } from "./modes";
import type { Example } from "./prompt";
import { rankBySimilarity } from "./similarity";
import { exampleRuns } from "./store";
import { countWords } from "./text";

const MAX_EXAMPLE_WORDS = 350;
const MAX_TOTAL_WORDS = 1500;

// Picks up to `k` past rewrites in the same mode that the user liked or
// corrected, most similar to the new input first. The user's corrected
// version, when there is one, is the example output.
export function pickExamples(mode: ModeId, input: string, k = 3): Example[] {
  const runs = exampleRuns(mode).filter(
    (r) => r.input.trim() !== input.trim() && countWords(r.input) <= MAX_EXAMPLE_WORDS,
  );
  if (runs.length === 0) return [];

  const examples: Example[] = [];
  let total = 0;
  for (const { doc } of rankBySimilarity(input, runs, (r) => r.input)) {
    const output = doc.finalOutput ?? doc.output;
    const words = countWords(doc.input) + countWords(output);
    if (total + words > MAX_TOTAL_WORDS) continue;
    examples.push({ input: doc.input, output });
    total += words;
    if (examples.length >= k) break;
  }
  return examples;
}
