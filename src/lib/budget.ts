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
    // reproduces the paragraph exactly.
    let gap = separator;
    for (const { text: sentence } of splitSentences(paragraph)) {
      const body = sentence.trimEnd();
      if (body) units.push({ separator: gap, text: body });
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

export function joinChunks(chunks: Chunk[]): string {
  return chunks.map((c) => c.separator + c.text).join("");
}
