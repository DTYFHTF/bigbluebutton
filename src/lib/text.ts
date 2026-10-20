export function countWords(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

export interface Sentence {
  text: string;
  start: number;
  end: number;
}

// Splits after ., ! or ? when followed by whitespace (so "3.5" and "e.g.x"
// stay intact) and at line breaks, keeping the trailing whitespace with the
// sentence so the pieces join back to the original.
export function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  const re = /[^\n]*?(?:[.!?]+["'’”)\]]*(?=\s|$)|\n|$)\s*/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match[0].length === 0) {
      re.lastIndex++;
      if (re.lastIndex > text.length) break;
      continue;
    }
    sentences.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return sentences;
}

// Mean and spread of sentence lengths, in words. Uniform sentence length is
// one of the most recognisable traits of machine-written prose.
export function sentenceRhythm(text: string): { count: number; mean: number; stdev: number } {
  const lengths = splitSentences(text)
    .map((s) => countWords(s.text))
    .filter((n) => n > 0);
  if (lengths.length === 0) return { count: 0, mean: 0, stdev: 0 };
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length;
  return { count: lengths.length, mean, stdev: Math.sqrt(variance) };
}
