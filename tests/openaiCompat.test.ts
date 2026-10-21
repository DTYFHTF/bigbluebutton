import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HttpError,
  chatRequest,
  createSpacer,
  createThinkFilter,
  extractJson,
  sseData,
  stripThinking,
} from "@/lib/openaiCompat";

describe("stripThinking", () => {
  it("removes think blocks and a dangling closer", () => {
    expect(stripThinking("<think>plan</think>Answer")).toBe("Answer");
    expect(stripThinking("reasoning only</think>\nAnswer")).toBe("Answer");
    expect(stripThinking("Plain text")).toBe("Plain text");
  });
});

describe("createThinkFilter", () => {
  function run(chunks: string[]) {
    const f = createThinkFilter();
    return chunks.map((c) => f.push(c)).join("") + f.flush();
  }

  it("passes ordinary text through unchanged", () => {
    expect(run(["Hello ", "wor", "ld <b>bold</b>"])).toBe("Hello world <b>bold</b>");
  });

  it("drops think blocks even when tags are split across chunks", () => {
    expect(run(["<thi", "nk>secret</th", "ink>Visible"])).toBe("Visible");
    expect(run(["Before <think>hid", "den</think> after"])).toBe("Before  after");
  });

  it("does not swallow a lone angle bracket", () => {
    expect(run(["a < b", " and c"])).toBe("a < b and c");
    expect(run(["ends with <"])).toBe("ends with <");
  });
});

describe("extractJson", () => {
  it("handles fences, prose and braces inside strings", () => {
    expect(extractJson('Sure!\n```json\n{"a": 1, "b": "x}y"}\n```')).toEqual({ a: 1, b: "x}y" });
    expect(extractJson('<think>{"no":1}</think>{"yes":2}')).toEqual({ yes: 2 });
  });

  it("throws when there is no usable object", () => {
    expect(() => extractJson("no json here")).toThrow();
    expect(() => extractJson('{"a": 1')).toThrow();
  });
});

describe("sseData", () => {
  it("yields data payloads across chunk boundaries", async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('data: {"a":1}\n\ndat'));
        c.enqueue(enc.encode('a: {"b":2}\r\n\n: comment\ndata: [DONE]'));
        c.close();
      },
    });
    const out: string[] = [];
    for await (const d of sseData(body)) out.push(d);
    expect(out).toEqual(['{"a":1}', '{"b":2}', "[DONE]"]);
  });
});

describe("chatRequest", () => {
  afterEach(() => vi.unstubAllGlobals());
  const req = { baseUrl: "http://x", apiKey: "k", model: "m", system: "s", user: "u", maxTokens: 10, stream: false };

  it("retries a 429 using Retry-After, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "retry-after": "0.01" } }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await chatRequest(req);
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer k");
  });

  it("sends no Authorization header without a key", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await chatRequest({ ...req, apiKey: undefined });
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json" });
  });

  it("does not retry client errors", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("nope", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const error = await chatRequest(req).catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("createSpacer", () => {
  it("spaces consecutive calls apart", async () => {
    const wait = createSpacer(60);
    const t0 = Date.now();
    await Promise.all([wait(), wait(), wait()]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(110);
  });

  it("is a no-op at 0", async () => {
    const t0 = Date.now();
    await createSpacer(0)();
    expect(Date.now() - t0).toBeLessThan(30);
  });
});
