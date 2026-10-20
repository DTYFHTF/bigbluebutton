import { diffWords, type DiffToken } from "./diff";
import { splitSentences } from "./text";

export interface Segment {
  start: number;
  end: number;
  tokens: DiffToken[];
}

// Groups the output's diff tokens into sentences. A token belongs to the
// sentence its first character falls in, so segment boundaries always land
// on token boundaries and the segments concatenate back to the output.
export function buildSegments(source: string, output: string): Segment[] {
  const tokens = diffWords(source, output);
  const sentences = splitSentences(output);
  const segments: Segment[] = [];
  let offset = 0;
  let s = 0;
  let currentSentence = -1;
  for (const token of tokens) {
    while (s < sentences.length - 1 && offset >= sentences[s].end) s++;
    if (s !== currentSentence) {
      segments.push({ start: offset, end: offset, tokens: [] });
      currentSentence = s;
    }
    const segment = segments[segments.length - 1];
    segment.tokens.push(token);
    offset += token.text.length;
    segment.end = offset;
  }
  return segments;
}
