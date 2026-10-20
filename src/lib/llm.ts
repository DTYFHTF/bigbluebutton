import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config, type Effort } from "./config";
import {
  HttpError,
  chatRequest,
  createSpacer,
  createThinkFilter,
  extractJson,
  sseData,
  stripThinking,
} from "./openaiCompat";

// One interface over the configured provider: Anthropic through its SDK, or
// any OpenAI-compatible endpoint (NVIDIA, OpenRouter, Groq) over fetch.

export interface LlmRequest {
  model: string;
  // Honoured by Anthropic models only.
  effort: Effort;
  maxTokens: number;
  system: string;
  user: string;
}

export class RefusalError extends Error {
  constructor() {
    super("This text couldn't be rewritten.");
  }
}

// Server-side fallback: if the primary Anthropic model declines a request, the
// API re-runs it on Anthropic's recommended fallback model in the same call.
// Only some models accept it (Haiku, for one, does not).
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export function fallbackParams(model: string): { betas?: string[]; fallbacks?: "default" } {
  return FALLBACK_MODELS.has(model) ? { betas: [FALLBACK_BETA], fallbacks: "default" } : {};
}

let anthropic: Anthropic | null = null;
function anthropicClient(): Anthropic {
  anthropic ??= new Anthropic();
  return anthropic;
}

const spacer = createSpacer(config.minIntervalMs);

function openAiTarget() {
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) throw new HttpError(401, `Set ${config.apiKeyEnv} in .env.local.`);
  if (!config.baseUrl) throw new HttpError(400, "Set HUMANLY_BASE_URL for the custom provider.");
  return { baseUrl: config.baseUrl, apiKey };
}

// Streams a text completion, calling onDelta for each chunk, and resolves to
// the full text. Streaming avoids HTTP timeouts on long rewrites.
export async function streamText(
  req: LlmRequest,
  { onDelta, signal }: { onDelta?: (text: string) => void; signal?: AbortSignal } = {},
): Promise<string> {
  if (config.provider !== "anthropic") return streamOpenAi(req, onDelta, signal);

  const stream = anthropicClient().beta.messages.stream(
    {
      model: req.model,
      max_tokens: req.maxTokens,
      output_config: { effort: req.effort },
      system: req.system,
      messages: [{ role: "user", content: req.user }],
      ...fallbackParams(req.model),
    },
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

async function streamOpenAi(
  req: LlmRequest,
  onDelta: ((text: string) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  const target = openAiTarget();
  await spacer(signal);
  const res = await chatRequest({ ...target, ...req, stream: true, signal });
  if (!res.body) throw new Error("The provider returned an empty response.");

  const filter = createThinkFilter();
  let text = "";
  const emit = (chunk: string) => {
    if (!chunk) return;
    text += chunk;
    onDelta?.(chunk);
  };
  for await (const data of sseData(res.body)) {
    if (data === "[DONE]") break;
    let event: { choices?: Array<{ delta?: { content?: string | null } }> };
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }
    emit(filter.push(event.choices?.[0]?.delta?.content ?? ""));
  }
  emit(filter.flush());
  return text.trim();
}

// Returns a reply parsed against a zod schema. Anthropic enforces the schema
// itself; other providers get it in the prompt and the reply is validated,
// with one retry that quotes the problem back to the model.
export async function generateJson<T>(
  schema: z.ZodType<T>,
  req: LlmRequest,
  { signal }: { signal?: AbortSignal } = {},
): Promise<T> {
  if (config.provider === "anthropic") {
    const response = await anthropicClient().beta.messages.parse(
      {
        model: req.model,
        max_tokens: req.maxTokens,
        output_config: { effort: req.effort, format: betaZodOutputFormat(schema) },
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        ...fallbackParams(req.model),
      },
      { signal },
    );
    if (response.stop_reason === "refusal") throw new RefusalError();
    if (!response.parsed_output) throw new Error("The model returned no structured output.");
    return response.parsed_output as T;
  }

  const target = openAiTarget();
  const system = `${req.system}\n\nReply with a single JSON object and nothing else: no prose, no code fence. It must match this JSON Schema:\n${JSON.stringify(
    z.toJSONSchema(schema),
  )}`;
  let user = req.user;
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    await spacer(signal);
    const res = await chatRequest({ ...target, model: req.model, maxTokens: req.maxTokens, system, user, stream: false, signal });
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
    const reply = stripThinking(body.choices?.[0]?.message?.content ?? "");
    try {
      return schema.parse(extractJson(reply));
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      user = `${req.user}\n\nYour previous reply could not be used (${lastError.slice(0, 300)}). Reply again with only the JSON object.`;
    }
  }
  throw new Error(`The model did not return valid JSON: ${lastError.slice(0, 200)}`);
}

export function describeApiError(error: unknown): { status: number; message: string } {
  if (error instanceof RefusalError) return { status: 422, message: error.message };
  if (error instanceof HttpError) {
    if (error.status === 401 || error.status === 403) {
      return { status: 500, message: `The ${config.providerLabel} API key is missing or invalid. Check ${config.apiKeyEnv}.` };
    }
    if (error.status === 404) {
      return { status: 500, message: "A configured model isn't available on this provider. Check HUMANLY_*_MODEL." };
    }
    if (error.status === 429) return { status: 429, message: "The provider's rate limit was hit. Wait a moment and try again." };
    if (error.status === 400) return { status: 400, message: `The provider rejected the request: ${error.body.slice(0, 200)}` };
    return { status: 502, message: "The rewriting service had a problem. Try again." };
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
