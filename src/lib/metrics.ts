import { splitSentences } from "./text";

// How much a rewrite actually changed. Unlike the positional diff in diff.ts,
// these ignore word order, so moving a clause doesn't count as changing it.

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

export function words(text: string): string[] {
  return (text.toLowerCase().match(WORD) ?? []).map((w) => w.replace(/’/g, "'"));
}

function counts(list: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const w of list) map.set(w, (map.get(w) ?? 0) + 1);
  return map;
}

// Share of the output's words that don't come from the input (each input
// word can account for one output word). 0 = same vocabulary, 1 = all new.
export function lexicalChange(input: string, output: string): number {
  const pool = counts(words(input));
  const out = words(output);
  if (out.length === 0) return 0;
  let fresh = 0;
  for (const w of out) {
    const left = pool.get(w) ?? 0;
    if (left > 0) pool.set(w, left - 1);
    else fresh++;
  }
  return fresh / out.length;
}

// Share of output sentences that aren't near-copies of an input sentence:
// a sentence counts as reworked when under 60% of its words appear in the
// closest input sentence.
export function sentencesReworked(input: string, output: string): number {
  const inSentences = splitSentences(input).map((s) => new Set(words(s.text))).filter((s) => s.size > 0);
  const outSentences = splitSentences(output).map((s) => words(s.text)).filter((w) => w.length > 0);
  if (outSentences.length === 0 || inSentences.length === 0) return 0;
  let reworked = 0;
  for (const sentence of outSentences) {
    let best = 0;
    for (const source of inSentences) {
      const shared = sentence.filter((w) => source.has(w)).length / sentence.length;
      if (shared > best) best = shared;
    }
    if (best < 0.6) reworked++;
  }
  return reworked / outSentences.length;
}

function bigrams(list: string[]): string[] {
  return list.length < 2 ? list : list.slice(1).map((w, i) => `${list[i]} ${w}`);
}

// Number of input sentences that still have a near-copy in the output: an
// output sentence containing at least 60% of the input sentence's word pairs.
// Word pairs, not single words, because a genuine rewrite keeps the content
// words (names, numbers, key nouns) but not their original sequence.
export function copiedSentences(input: string, output: string): number {
  const outSentences = splitSentences(output)
    .map((s) => new Set(bigrams(words(s.text))))
    .filter((s) => s.size > 0);
  let copied = 0;
  for (const { text } of splitSentences(input)) {
    const source = bigrams(words(text));
    if (source.length === 0) continue;
    const kept = Math.max(0, ...outSentences.map((out) => source.filter((b) => out.has(b)).length / source.length));
    if (kept >= 0.6) copied++;
  }
  return copied;
}

const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16",
  seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20", thirty: "30", forty: "40", fifty: "50",
  sixty: "60", seventy: "70", eighty: "80", ninety: "90", hundred: "100", thousand: "1000",
};

const UNITS = new Set(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]);
const TENS = new Set(["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]);
// "one" is often a pronoun: "no one", "the one in Leeds", "one of them".
const PRONOUN_BEFORE = new Set(["no", "any", "every", "each", "some", "the", "this", "that", "which", "anyone", "someone"]);
const PRONOUN_AFTER = new Set(["of", "another"]);

const DIGITS = /\d[\d,]*(?:\.\d+)?/g;

// "1,200" -> "1200", "03" -> "3"; decimals are kept as written.
function normalizeDigits(n: string): string {
  const plain = n.replace(/,(?=\d{3}\b)/g, "").replace(/,$/, "");
  return plain.includes(".") ? plain : plain.replace(/^0+(?=\d)/, "");
}

function spelledNumbers(text: string): string[] {
  const list = words(text);
  const found: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const parts = list[i].split("-");
    for (let j = 0; j < parts.length; j++) {
      const part = parts[j];
      if (!(part in NUMBER_WORDS)) continue;
      // Tens followed by a unit, hyphenated or not: "twenty-three", "twenty three".
      const nextPart = parts[j + 1] ?? (j === parts.length - 1 ? list[i + 1] : undefined);
      if (TENS.has(part) && nextPart && UNITS.has(nextPart)) {
        found.push(String(Number(NUMBER_WORDS[part]) + Number(NUMBER_WORDS[nextPart])));
        if (parts[j + 1] !== undefined) j++;
        else i++;
        continue;
      }
      if (part === "one" && parts.length === 1 && (PRONOUN_BEFORE.has(list[i - 1] ?? "") || PRONOUN_AFTER.has(list[i + 1] ?? ""))) {
        continue;
      }
      found.push(NUMBER_WORDS[part]);
    }
  }
  return found;
}

// Numbers in a text, normalised so "1,200" matches "1200", "03" matches "3",
// and "nine" or "twenty-three" match 9 and 23.
export function numbersIn(text: string): string[] {
  return [...(text.match(DIGITS) ?? []).map(normalizeDigits), ...spelledNumbers(text)];
}

// Numbers written as digits in the input that the output no longer contains
// in any form. Spelled-out input numbers aren't checked: they're often
// reworded ("a couple of").
export function missingNumbers(input: string, output: string): string[] {
  const available = counts(numbersIn(output));
  const missing: string[] = [];
  for (const n of (input.match(DIGITS) ?? []).map(normalizeDigits)) {
    const left = available.get(n) ?? 0;
    if (left > 0) available.set(n, left - 1);
    else missing.push(n);
  }
  return missing;
}
