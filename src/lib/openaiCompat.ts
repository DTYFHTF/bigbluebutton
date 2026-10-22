// Minimal client for OpenAI-compatible chat completion endpoints (NVIDIA,
// OpenRouter, Groq, ...). Pure helpers are exported so they can be tested
// without a network.

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

// Reasoning models sometimes put their thinking in the visible text, inside
// <think> tags. Removes complete blocks from a finished string.
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();
}

// Filters <think>…</think> out of a stream of text deltas. A tag can be split
// across chunks, so a possible partial tag is held back until it resolves.
export function createThinkFilter() {
  let inThink = false;
  let pending = "";
  const OPEN = "<think>";
  const CLOSE = "</think>";
  return {
    push(chunk: string): string {
      let text = pending + chunk;
      pending = "";
      let out = "";
      for (;;) {
        const tag = inThink ? CLOSE : OPEN;
        const at = text.toLowerCase().indexOf(tag);
        if (at >= 0) {
          if (!inThink) out += text.slice(0, at);
          text = text.slice(at + tag.length);
          inThink = !inThink;
          continue;
        }
        // Hold back a tail that could be the start of the tag.
        let keep = 0;
        for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
          if (tag.startsWith(text.slice(-n).toLowerCase())) {
            keep = n;
            break;
          }
        }
        if (!inThink) out += text.slice(0, text.length - keep);
        pending = text.slice(text.length - keep);
        return out;
      }
    },
    flush(): string {
      const rest = inThink ? "" : pending;
      pending = "";
      return rest;
    },
  };
}

// Pulls a JSON object out of a model reply that may wrap it in prose or a
// code fence.
export function extractJson(text: string): unknown {
  const cleaned = stripThinking(text).replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  if (start < 0) throw new Error("The model reply contained no JSON object.");
  let depth = 0;
  let inString = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
  }
  throw new Error("The model reply contained an unterminated JSON object.");
}

// Names of properties a JSON Schema declares as numbers, at any depth.
export function numericKeys(schema: unknown, out = new Set<string>()): Set<string> {
  if (!schema || typeof schema !== "object") return out;
  const node = schema as Record<string, unknown>;
  const props = node.properties as Record<string, Record<string, unknown>> | undefined;
  if (props) {
    for (const [key, sub] of Object.entries(props)) {
      if (sub && (sub.type === "number" || sub.type === "integer")) out.add(key);
      numericKeys(sub, out);
    }
  }
  if (node.items) numericKeys(node.items, out);
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const list = node[key];
    if (Array.isArray(list)) list.forEach((sub) => numericKeys(sub, out));
  }
  return out;
}

// Small models sometimes quote numbers ("naturalness": "8"). Turns numeric
// strings into numbers, but only under the given keys, so a quoted "2025" in
// a text field stays a string and anything malformed still fails validation.
export function coerceNumericStrings(value: unknown, keys: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((v) => coerceNumericStrings(v, keys));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => {
        if (keys.has(k) && typeof v === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return [k, Number(v)];
        return [k, coerceNumericStrings(v, keys)];
      }),
    );
  }
  return value;
}

// Splits a server-sent-events byte stream into `data:` payloads.
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
  const last = buffer.trim();
  if (last.startsWith("data:")) yield last.slice(5).trim();
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  baseUrl: string;
  // Omitted for local servers that don't authenticate.
  apiKey?: string;
  model: string;
  system: string;
  // Example exchanges placed between the system prompt and the real request.
  history?: ChatTurn[];
  user: string;
  maxTokens: number;
  stream: boolean;
  // Extra top-level fields (sampling, provider extensions), sent as given.
  extra?: Record<string, unknown>;
  signal?: AbortSignal;
}

export function chatBody(req: ChatRequest): Record<string, unknown> {
  return {
    model: req.model,
    max_tokens: req.maxTokens,
    stream: req.stream,
    messages: [
      { role: "system", content: req.system },
      ...(req.history ?? []),
      { role: "user", content: req.user },
    ],
    ...req.extra,
  };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

// Free tiers answer 429 when busy; wait as the server asks and retry.
export async function chatRequest(req: ChatRequest, retries = 4): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${req.baseUrl}/chat/completions`, {
      method: "POST",
      signal: req.signal,
      headers: {
        "Content-Type": "application/json",
        ...(req.apiKey ? { Authorization: `Bearer ${req.apiKey}` } : {}),
      },
      body: JSON.stringify(chatBody(req)),
    });
    if (res.ok) return res;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) throw new HttpError(res.status, await res.text());
    const header = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(header) && header > 0 ? header * 1000 : 2000 * 2 ** attempt;
    await res.body?.cancel();
    await sleep(Math.min(wait, 30_000), req.signal);
  }
}

// Spaces calls apart so parallel drafts don't burst past a per-minute cap.
export function createSpacer(minIntervalMs: number) {
  let next = 0;
  return async (signal?: AbortSignal) => {
    if (minIntervalMs <= 0) return;
    const now = Date.now();
    const start = Math.max(now, next);
    next = start + minIntervalMs;
    if (start > now) await sleep(start - now, signal);
  };
}
