import { words } from "./metrics";

// Removes wrapper text models add around a rewrite ("Here is the rewritten
// text:", trailing notes about the edit, echoed tags, wrapping quotes).
// It is deliberately conservative. A first or last paragraph is removed only
// when all of these hold:
// - the output has more paragraphs than the input has lines,
// - the paragraph is explicitly about the rewrite itself,
// - few of its words come from the input (a real lead-in or closing reuses them),
// - it carries none of the input's numbers,
// - the input doesn't start or end the same way.

const PREAMBLE_START = /^(?:sure|certainly|of course|okay|ok|absolutely|here(?:'s| is| are)|below is|the following is)\b/i;
const ABOUT_REWRITE =
  /\b(?:rewrit\w*|revis\w*|paraphras\w*|reword\w*|version|(?:more natural|natural|new|updated|improved|polished) (?:text|passage))\b/i;
const TRAILER_START =
  /^(?:notes?:|n\.b\.|i (?:have|'ve) (?:kept|preserved|maintained|changed|made|rewritten|revised|adjusted|tried|removed|replaced)\b|this (?:rewrite|revision|rewritten version|version)\b|(?:the )?changes (?:made|include)\b|let me know if you(?:'d| would)? (?:like|want|need) (?:any )?(?:further |more |other )?(?:changes|adjustments|edits|tweaks|revisions|another version)\b)/i;
const ABOUT_EDIT = /\b(?:rewr\w*|revis\w*|paraphras\w*|kept|preserv\w*|maintain\w*|chang\w*|version|original|tone|meaning|style|wording)\b/i;
const TAG = /<\/?(?:text|rewrite|original|draft|passage)>/gi;
const QUOTES: Array<[string, string]> = [
  ['"', '"'],
  ["“", "”"],
];
const STOP = new Set(
  "a an and are as at be but by for from has have i in is it its of on or that the this to was were will with you your we our here".split(" "),
);

function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

// Share of the paragraph's content words that also appear in the input.
function overlap(paragraph: string, inputWords: Set<string>): number {
  const content = words(paragraph).filter((w) => w.length > 2 && !STOP.has(w));
  if (content.length === 0) return 0;
  return content.filter((w) => inputWords.has(w)).length / content.length;
}

function carriesInputNumber(paragraph: string, input: string): boolean {
  const inputNumbers = new Set(input.match(/\d+/g) ?? []);
  return (paragraph.match(/\d+/g) ?? []).some((n) => inputNumbers.has(n));
}

export function cleanOutput(input: string, output: string): string {
  let text = output.trim();

  if (!/<\/?(?:text|rewrite|original|draft|passage)>/i.test(input)) {
    text = text.replace(TAG, "").trim();
  }

  for (const [open, close] of QUOTES) {
    const inner = text.slice(open.length, -close.length);
    if (
      text.length > 2 &&
      text.startsWith(open) &&
      text.endsWith(close) &&
      !input.trim().startsWith(open) &&
      !inner.includes(open) &&
      !inner.includes(close)
    ) {
      text = inner.trim();
    }
  }

  const inputLines = input.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const inputWords = new Set(words(input));
  const removable = (p: string, limit: number) => overlap(p, inputWords) < limit && !carriesInputNumber(p, input);

  let outParas = paragraphs(text);
  if (outParas.length > inputLines.length && outParas.length > 1) {
    const first = outParas[0];
    if (
      first.length <= 200 &&
      PREAMBLE_START.test(first) &&
      ABOUT_REWRITE.test(first) &&
      !PREAMBLE_START.test(inputLines[0] ?? "") &&
      removable(first, 0.3)
    ) {
      text = text.slice(text.indexOf(first) + first.length).trim();
      outParas = paragraphs(text);
    }
  }
  if (outParas.length > inputLines.length && outParas.length > 1) {
    const last = outParas[outParas.length - 1];
    if (
      TRAILER_START.test(last) &&
      ABOUT_EDIT.test(last) &&
      !TRAILER_START.test(inputLines[inputLines.length - 1] ?? "") &&
      removable(last, 0.5)
    ) {
      // Drop a rule line ("---") the model put between the text and its note.
      text = text.slice(0, text.lastIndexOf(last)).trim().replace(/\n\s*(?:[-*_]\s*){3,}$/, "").trim();
    }
  }
  return text;
}
