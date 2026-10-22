// Removes wrapper text models add around a rewrite ("Here is the rewritten
// text:", trailing notes about the edit, echoed tags, wrapping quotes).
// It is deliberately conservative: a paragraph is only removed when the
// output has gained a paragraph the input doesn't have, the paragraph talks
// about the rewrite itself, and the input doesn't start or end the same way.

const PREAMBLE =
  /^(?:(?:sure|certainly|of course|okay|ok|absolutely)\b.{0,140}|(?:here(?:'s| is| are)|below is|the following is)\b.{0,140}\b(?:rewrit|revis|paraphras|version|text|passage)\w*.{0,60}[:.!]?)$/i;
const TRAILER =
  /^(?:note|notes|n\.b\.|i (?:have|'ve) (?:kept|preserved|maintained|changed|made|rewritten|revised|adjusted|tried)|let me know|i hope|this (?:rewrite|version|revision|rewritten)|(?:the )?changes (?:made|include))\b/i;
const ABOUT_THE_EDIT = /(rewrit|revis|paraphras|kept|preserv|maintain|chang|version|original|tone|meaning|style|wording)/i;
const TAG = /<\/?(?:text|rewrite|original|draft|passage)>/gi;
const QUOTES: Array<[string, string]> = [
  ['"', '"'],
  ["“", "”"],
];

function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
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

  const inParas = paragraphs(input);
  let outParas = paragraphs(text);
  if (outParas.length > inParas.length && outParas.length > 1) {
    const first = outParas[0];
    if (PREAMBLE.test(first) && !PREAMBLE.test(inParas[0] ?? "")) {
      text = text.slice(text.indexOf(first) + first.length).trim();
      outParas = paragraphs(text);
    }
  }
  if (outParas.length > inParas.length && outParas.length > 1) {
    const last = outParas[outParas.length - 1];
    const inputLast = inParas[inParas.length - 1] ?? "";
    if (TRAILER.test(last) && ABOUT_THE_EDIT.test(last) && !TRAILER.test(inputLast)) {
      // Drop a rule line ("---") the model put between the text and its note.
      text = text.slice(0, text.lastIndexOf(last)).trim().replace(/\n\s*(?:[-*_]\s*){3,}$/, "").trim();
    }
  }
  return text;
}
