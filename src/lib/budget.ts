import { splitSentences } from "./text";

// Prompt budgeting for providers with a small, fixed context window (Ollama's
// default is 4096 tokens). Token counts are estimated from characters; the
// estimate errs high so a prompt that "fits" really does.

const CHARS_PER_TOKEN = 3.3;
// Chat-template tokens around each message, and a margin for estimate error.
const PER_MESSAGE = 8;
const MARGIN = 96;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface PromptParts {
  system: string;
  history?: Array<{ content: string }>;
  user: string;
}

export function promptTokens(parts: PromptParts): number {
  const history = parts.history ?? [];
  return (
    estimateTokens(parts.system) +
    estimateTokens(parts.user) +
    history.reduce((sum, turn) => sum + estimateTokens(turn.content), 0) +
    PER_MESSAGE * (2 + history.length)
  );
}

export function budgetFor(parts: PromptParts, numCtx: number): { promptTokens: number; available: number } {
  const used = promptTokens(parts);
  return { promptTokens: used, available: numCtx - used - MARGIN };
}

export class ContextOverflowError extends Error {
  constructor(
    public promptTokens: number,
    public neededOutput: number,
    public numCtx: number,
  ) {
    super(`Prompt of ~${promptTokens} tokens leaves no room for ${neededOutput} output tokens in a ${numCtx}-token window.`);
  }
}

export interface Chunk {
  // What goes before this chunk when the rewritten chunks are joined back
  // together: "" for the first, a blank line between paragraphs, a space
  // inside a paragraph that had to be split.
  separator: string;
  text: string;
}

// Splits text into chunks of at most `maxTokens` estimated tokens, breaking
// between paragraphs where possible and between sentences otherwise.
export function chunkText(text: string, maxTokens: number): Chunk[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const units: Chunk[] = [];
  paragraphs.forEach((paragraph, i) => {
    const separator = i === 0 ? "" : "\n\n";
    if (estimateTokens(paragraph) <= maxTokens) {
      units.push({ separator, text: paragraph });
      return;
    }
    // Keep the whitespace that originally followed each sentence, so joining
    // reproduces the paragraph exactly. Text with no sentence punctuation is
    // split further at clause punctuation, then at spaces.
    let gap = separator;
    for (const { text: sentence } of splitSentences(paragraph)) {
      const body = sentence.trimEnd();
      if (body) {
        for (const piece of splitLong(body, maxTokens)) {
          units.push({ separator: piece.first ? gap : piece.gap, text: piece.text });
        }
      }
      gap = sentence.slice(body.length) || " ";
    }
  });

  const chunks: Chunk[] = [];
  for (const unit of units) {
    const last = chunks[chunks.length - 1];
    const joined = last ? last.text + unit.separator + unit.text : "";
    if (last && estimateTokens(joined) <= maxTokens) last.text = joined;
    else chunks.push({ ...unit });
  }
  return chunks;
}

// Splits a sentence that alone exceeds maxTokens: after clause punctuation
// (; : , and dashes) where possible, otherwise at the last space that fits.
function splitLong(sentence: string, maxTokens: number): Array<{ text: string; gap: string; first: boolean }> {
  if (estimateTokens(sentence) <= maxTokens) return [{ text: sentence, gap: "", first: true }];
  const maxChars = Math.max(20, Math.floor(maxTokens * CHARS_PER_TOKEN));
  const pieces: Array<{ text: string; gap: string; first: boolean }> = [];
  let rest = sentence;
  let gap = "";
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars + 1);
    const clause = Math.max(window.lastIndexOf("; "), window.lastIndexOf(": "), window.lastIndexOf(", "), window.lastIndexOf(" — "));
    const space = window.lastIndexOf(" ");
    const cut = clause > maxChars / 3 ? clause + 1 : space > 0 ? space : maxChars;
    pieces.push({ text: rest.slice(0, cut).trimEnd(), gap, first: pieces.length === 0 });
    const after = rest.slice(cut);
    gap = after.match(/^\s*/)?.[0] || "";
    rest = after.slice(gap.length);
  }
  if (rest) pieces.push({ text: rest, gap, first: pieces.length === 0 });
  return pieces;
}

export function joinChunks(chunks: Chunk[]): string {
  return chunks.map((c) => c.separator + c.text).join("");
}
