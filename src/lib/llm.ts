import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { budgetFor, ContextOverflowError } from "./budget";
import { config, type Effort, type ProviderTarget } from "./config";
import {
  HttpError,
  type ChatTurn,
  chatRequest,
  coerceNumericStrings,
  createSpacer,
  createThinkFilter,
  extractJson,
  numericKeys,
  sseData,
  stripThinking,
} from "./openaiCompat";

// One interface over the configured providers: Anthropic through its SDK, or
// any OpenAI-compatible endpoint (Ollama, NVIDIA, OpenRouter, Groq) over fetch.

// "judge" calls go to the judge's provider and use deterministic sampling;
// everything else goes to the main provider.
export type CallRole = "draft" | "judge" | "alt" | "learn";

export interface LlmRequest {
  model: string;
  // Honoured by Anthropic models only.
  effort: Effort;
  maxTokens: number;
  system: string;
  // Example exchanges shown before the real request.
  history?: ChatTurn[];
  user: string;
  role?: CallRole;
  // OpenAI-compatible providers only; Anthropic never receives these.
  temperature?: number;
  seed?: number;
  // Smallest output that still makes the call worthwhile. With a context
  // budget, max_tokens shrinks to what fits, but never below this.
  minOutputTokens?: number;
}

export class RefusalError extends Error {
  constructor() {
    super("This text couldn't be rewritten.");
  }
}

// The model hit its output limit, so the text it returned is incomplete.
export class OutputTruncatedError extends Error {
  constructor() {
    super("The model stopped before it finished the rewrite.");
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

function targetFor(req: LlmRequest): ProviderTarget {
  return req.role === "judge" ? config.judge : config.main;
}

const spacers = new Map<string, ReturnType<typeof createSpacer>>();
function spacerFor(t: ProviderTarget) {
  let spacer = spacers.get(t.provider);
  if (!spacer) {
    spacer = createSpacer(t.minIntervalMs);
    spacers.set(t.provider, spacer);
  }
  return spacer;
}

function openAiTarget(t: ProviderTarget) {
  const apiKey = process.env[t.apiKeyEnv];
  if (!apiKey && !t.apiKeyOptional) throw new HttpError(401, `Set ${t.apiKeyEnv} in .env.local.`);
  if (!t.baseUrl) throw new HttpError(400, "Set HUMANLY_BASE_URL for the custom provider.");
  return { baseUrl: t.baseUrl, apiKey };
}

// Sampling and provider extensions for one OpenAI-compatible call. Judge
// calls are deterministic; drafts use the configured values or the provider
// default. HUMANLY_SAMPLING=off sends none of this.
export function samplingExtra(req: LlmRequest, t: ProviderTarget): Record<string, unknown> {
  if (!config.sampling) return {};
  const judgeCall = req.role === "judge";
  const extra: Record<string, unknown> = {};
  const temperature = req.temperature ?? (judgeCall ? config.judgeTemperature : config.draftTemperature);
  if (temperature !== undefined) extra.temperature = Math.min(t.provider === "nvidia" ? 1 : 2, Math.max(0, temperature));
  const seed = req.seed ?? (judgeCall ? config.judgeSeed : config.seed);
  if (seed !== undefined) extra.seed = Math.trunc(seed);
  if (t.provider === "ollama") {
    // "none" turns thinking off on reasoning models and is ignored by others.
    if (!config.think) extra.reasoning_effort = "none";
    extra.keep_alive = config.keepAlive;
  }
  return extra;
}

// Fits the request to the provider's context window: max_tokens shrinks to
// the room left after the prompt, and a prompt that leaves too little room
// fails loudly instead of being cut from the front by the server.
function budgeted(req: LlmRequest, t: ProviderTarget): number {
  if (t.numCtx <= 0) return req.maxTokens;
  const budget = budgetFor({ system: req.system, history: req.history, user: req.user }, t.numCtx);
  const needed = Math.min(req.maxTokens, req.minOutputTokens ?? 256);
  if (budget.available < needed) throw new ContextOverflowError(budget.promptTokens, needed, t.numCtx);
  return Math.min(req.maxTokens, budget.available);
}

// A 400 on an extension field (an older server, a stricter provider) gets
// one retry with the plain request.
async function withPlainFallback(
  send: (extra: Record<string, unknown>) => Promise<Response>,
  extra: Record<string, unknown>,
): Promise<Response> {
  try {
    return await send(extra);
  } catch (error) {
    if (error instanceof HttpError && error.status === 400 && Object.keys(extra).length > 0) {
      console.warn(`provider rejected extra fields (${Object.keys(extra).join(", ")}); retrying without them`);
      return send({});
    }
    throw error;
  }
}

// Streams a text completion, calling onDelta for each chunk, and resolves to
// the full text. Streaming avoids HTTP timeouts on long rewrites.
export async function streamText(
  req: LlmRequest,
  { onDelta, signal }: { onDelta?: (text: string) => void; signal?: AbortSignal } = {},
): Promise<string> {
  const t = targetFor(req);
  if (t.provider !== "anthropic") return streamOpenAi(req, t, onDelta, signal);

  const stream = anthropicClient().beta.messages.stream(
    {
      model: req.model,
      max_tokens: req.maxTokens,
      output_config: { effort: req.effort },
      system: req.system,
      messages: [...(req.history ?? []), { role: "user", content: req.user }],
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
  if (message.stop_reason === "max_tokens") throw new OutputTruncatedError();
  return text.trim();
}

async function streamOpenAi(
  req: LlmRequest,
  t: ProviderTarget,
  onDelta: ((text: string) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  const target = openAiTarget(t);
  const maxTokens = budgeted(req, t);
  await spacerFor(t)(signal);
  const res = await withPlainFallback(
    (extra) =>
      chatRequest({
        ...target,
        model: req.model,
        system: req.system,
        history: req.history,
        user: req.user,
        maxTokens,
        stream: true,
        extra,
        signal,
      }),
    samplingExtra(req, t),
  );
  if (!res.body) throw new Error("The provider returned an empty response.");

  const filter = createThinkFilter();
  let text = "";
  let finishReason: string | null = null;
  const emit = (chunk: string) => {
    if (!chunk) return;
    text += chunk;
    onDelta?.(chunk);
  };
  for await (const data of sseData(res.body)) {
    if (data === "[DONE]") break;
    let event: { choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }> };
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }
    const choice = event.choices?.[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    emit(filter.push(choice?.delta?.content ?? ""));
  }
  emit(filter.flush());
  if (finishReason === "length") throw new OutputTruncatedError();
  return text.trim();
}

// Returns a reply parsed against a zod schema. Anthropic enforces the schema
// itself. Other providers get it in the prompt (and, on Ollama, as a decoding
// grammar); the reply is validated, with one retry that quotes the problem
// back to the model.
export async function generateJson<T>(
  schema: z.ZodType<T>,
  req: LlmRequest,
  { signal }: { signal?: AbortSignal } = {},
): Promise<T> {
  const t = targetFor(req);
  if (t.provider === "anthropic") {
    const response = await anthropicClient().beta.messages.parse(
      {
        model: req.model,
        max_tokens: req.maxTokens,
        output_config: { effort: req.effort, format: betaZodOutputFormat(schema) },
        system: req.system,
        messages: [...(req.history ?? []), { role: "user", content: req.user }],
        ...fallbackParams(req.model),
      },
      { signal },
    );
    if (response.stop_reason === "refusal") throw new RefusalError();
    if (!response.parsed_output) throw new Error("The model returned no structured output.");
    return response.parsed_output as T;
  }

  const target = openAiTarget(t);
  const jsonSchema = z.toJSONSchema(schema);
  const numbers = numericKeys(jsonSchema);
  const system = `${req.system}\n\nReply with a single JSON object and nothing else: no prose, no code fence. It must match this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
  const extra = samplingExtra(req, t);
  if (config.sampling && t.provider === "ollama") {
    // Ollama constrains decoding to the schema, so small models can't drift
    // into prose or broken JSON.
    extra.response_format = { type: "json_schema", json_schema: { name: "result", schema: jsonSchema } };
  }
  let user = req.user;
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const maxTokens = budgeted({ ...req, system, user }, t);
    await spacerFor(t)(signal);
    const res = await withPlainFallback(
      (fields) =>
        chatRequest({ ...target, model: req.model, maxTokens, system, history: req.history, user, stream: false, extra: fields, signal }),
      extra,
    );
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
    };
    // A reply cut off at max_tokens can't be valid JSON, and retrying with the
    // same limit would fail the same way.
    if (body.choices?.[0]?.finish_reason === "length") throw new OutputTruncatedError();
    const reply = stripThinking(body.choices?.[0]?.message?.content ?? "");
    try {
      return schema.parse(coerceNumericStrings(extractJson(reply), numbers));
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      user = `${req.user}\n\nYour previous reply could not be used (${lastError.slice(0, 300)}). Reply again with only the JSON object.`;
    }
  }
  throw new Error(`The model did not return valid JSON: ${lastError.slice(0, 200)}`);
}

export function describeApiError(error: unknown): { status: number; message: string } {
  if (error instanceof RefusalError) return { status: 422, message: error.message };
  if (error instanceof OutputTruncatedError) {
    return { status: 422, message: "The model ran out of room before finishing. Try a shorter passage." };
  }
  if (error instanceof ContextOverflowError) {
    return {
      status: 413,
      message: `This is too long for the model's ${error.numCtx}-token context window. Try a shorter passage, or raise the window (see README: HUMANLY_NUM_CTX).`,
    };
  }
  if (error instanceof HttpError) {
    if (error.status === 401 || error.status === 403) {
      return { status: 500, message: `The ${config.providerLabel} API key is missing or invalid. Check ${config.apiKeyEnv}.` };
    }
    if (error.status === 404) {
      const hint = config.provider === "ollama" ? " Pull it first with `ollama pull <model>`." : "";
      return { status: 500, message: `A configured model isn't available on this provider. Check HUMANLY_*_MODEL.${hint}` };
    }
    if (error.status === 429) return { status: 429, message: "The provider's rate limit was hit. Wait a moment and try again." };
    if (error.status === 400) return { status: 400, message: `The provider rejected the request: ${error.body.slice(0, 200)}` };
    return { status: 502, message: "The rewriting service had a problem. Try again." };
  }
  // fetch() rejects with a TypeError when nothing is listening at the address.
  if (error instanceof TypeError && config.provider !== "anthropic") {
    const hint = config.provider === "ollama" ? " Is Ollama running? Start it with `ollama serve`." : "";
    return { status: 502, message: `Couldn't reach ${config.providerLabel} at ${config.baseUrl}.${hint}` };
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
