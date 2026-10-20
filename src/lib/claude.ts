import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.HUMANLY_MODEL ?? "claude-opus-5-5";
export const MAX_WORDS = Number(process.env.HUMANLY_MAX_WORDS ?? 1500);

// Server-side fallback: if the primary model declines a request, the API
// re-runs it on Anthropic's recommended fallback model in the same call.
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let client: Anthropic | null = null;

export function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export function describeApiError(error: unknown): { status: number; message: string } {
  if (error instanceof Anthropic.AuthenticationError) {
    return { status: 500, message: "The server's Anthropic API key is missing or invalid." };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { status: 429, message: "The service is busy right now. Try again in a moment." };
  }
  if (error instanceof Anthropic.BadRequestError) {
    return { status: 400, message: "That request couldn't be processed. Try shorter or different text." };
  }
  if (error instanceof Anthropic.APIError) {
    return { status: 502, message: "The rewriting service had a problem. Try again." };
  }
  return { status: 500, message: "Something went wrong. Try again." };
}
