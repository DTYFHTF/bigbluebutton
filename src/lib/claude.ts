import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages";

// Server-side fallback: if the primary model declines a request, the API
// re-runs it on Anthropic's recommended fallback model in the same call.
// Only some models accept it (Haiku, for one, does not).
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export function fallbackParams(model: string): { betas?: string[]; fallbacks?: "default" } {
  return FALLBACK_MODELS.has(model) ? { betas: [FALLBACK_BETA], fallbacks: "default" } : {};
}

let client: Anthropic | null = null;

export function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export class RefusalError extends Error {
  constructor() {
    super("This text couldn't be rewritten.");
  }
}

type TextRequest = Omit<BetaMessageStreamParams, "betas" | "fallbacks" | "stream">;

// Streams a text completion, calling onDelta for each chunk, and resolves to
// the full text. Streaming avoids HTTP timeouts on long rewrites.
export async function streamText(
  params: TextRequest,
  { onDelta, signal }: { onDelta?: (text: string) => void; signal?: AbortSignal } = {},
): Promise<string> {
  const stream = getClient().beta.messages.stream(
    { ...params, ...fallbackParams(params.model) },
    { signal },
  );
  let text = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      text += event.delta.text;
      onDelta?.(event.delta.text);
    }
  }
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new RefusalError();
  return text.trim();
}

export function describeApiError(error: unknown): { status: number; message: string } {
  if (error instanceof RefusalError) {
    return { status: 422, message: error.message };
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return { status: 500, message: "The server's Anthropic API key is missing or invalid." };
  }
  if (error instanceof Anthropic.NotFoundError) {
    return { status: 500, message: "A configured model isn't available to this API key. Check HUMANLY_*_MODEL." };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { status: 429, message: "The API rate limit was hit. Try again in a moment." };
  }
  if (error instanceof Anthropic.BadRequestError) {
    return { status: 400, message: `The API rejected the request: ${error.message}` };
  }
  if (error instanceof Anthropic.APIError) {
    return { status: 502, message: "The rewriting service had a problem. Try again." };
  }
  return { status: 500, message: error instanceof Error ? error.message : "Something went wrong." };
}
