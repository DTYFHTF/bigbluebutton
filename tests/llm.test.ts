import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Configure an Ollama setup before llm.ts reads the environment.
process.env.HUMANLY_PROVIDER = "ollama";
process.env.HUMANLY_BASE_URL = "http://mock.local/v1";
process.env.HUMANLY_NUM_CTX = "1024";
delete process.env.HUMANLY_DRAFT_TEMPERATURE;
delete process.env.HUMANLY_SEED;

let llm: typeof import("@/lib/llm");
let budget: typeof import("@/lib/budget");
beforeAll(async () => {
  vi.resetModules();
  llm = await import("@/lib/llm");
  budget = await import("@/lib/budget");
});
afterEach(() => vi.unstubAllGlobals());

function sse(chunks: string[], finish = "stop") {
  const lines = chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
  lines.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`);
  return new Response(lines.join(""), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const base = { model: "m", effort: "low" as const, maxTokens: 400, system: "sys", user: "hello" };

describe("samplingExtra", () => {
  it("makes judge calls deterministic and drafts use provider defaults", async () => {
    const { config } = await import("@/lib/config");
    expect(llm.samplingExtra({ ...base, role: "judge" }, config.main)).toEqual({
      temperature: 0,
      seed: 7,
      reasoning_effort: "none",
      keep_alive: "30m",
    });
    expect(llm.samplingExtra({ ...base, role: "draft" }, config.main)).toEqual({ reasoning_effort: "none", keep_alive: "30m" });
    expect(llm.samplingExtra({ ...base, temperature: 0.7, seed: 3 }, config.main)).toMatchObject({ temperature: 0.7, seed: 3 });
  });
});

describe("streamText (OpenAI-compatible)", () => {
  it("sends history and extras, and strips think blocks", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => sse(["<think>x</think>Hel", "lo"]));
    vi.stubGlobal("fetch", fetchMock);
    const text = await llm.streamText({ ...base, history: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] });
    expect(text).toBe("Hello");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(body.reasoning_effort).toBe("none");
    expect(body.keep_alive).toBe("30m");
    expect(body.max_tokens).toBeLessThanOrEqual(400);
  });

  it("throws when the output was cut off", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => sse(["partial"], "length")));
    await expect(llm.streamText(base)).rejects.toBeInstanceOf(llm.OutputTruncatedError);
  });

  it("refuses a prompt that would overflow the context window", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const big = "word ".repeat(1200);
    await expect(llm.streamText({ ...base, user: big, minOutputTokens: 300 })).rejects.toBeInstanceOf(budget.ContextOverflowError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shrinks max_tokens to the room left in the window", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => sse(["ok"]));
    vi.stubGlobal("fetch", fetchMock);
    await llm.streamText({ ...base, maxTokens: 64000, user: "x".repeat(1000), minOutputTokens: 100 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_tokens).toBeLessThan(1024);
    expect(body.max_tokens).toBeGreaterThanOrEqual(100);
  });

  it("retries without extension fields when the provider rejects them", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => new Response("unknown field reasoning_effort", { status: 400 }))
      .mockImplementationOnce(async () => sse(["fine"]));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await llm.streamText(base)).toBe("fine");
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second.reasoning_effort).toBeUndefined();
  });
});

describe("generateJson (OpenAI-compatible)", () => {
  const schema = z.object({ items: z.array(z.object({ label: z.string(), score: z.number() })) });
  const reply = (content: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "Content-Type": "application/json" } });

  it("asks Ollama for schema-constrained JSON and coerces quoted numbers only where numbers belong", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => reply('{"items":[{"label":"2025","score":"8"}]}'));
    vi.stubGlobal("fetch", fetchMock);
    const result = await llm.generateJson(schema, { ...base, role: "judge" });
    expect(result).toEqual({ items: [{ label: "2025", score: 8 }] });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.temperature).toBe(0);
  });

  it("retries once when the reply doesn't validate", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => reply('{"items":[{"label":"A","score":"high"}]}'))
      .mockImplementationOnce(async () => reply('{"items":[{"label":"A","score":7}]}'));
    vi.stubGlobal("fetch", fetchMock);
    expect(await llm.generateJson(schema, base)).toEqual({ items: [{ label: "A", score: 7 }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("describeApiError", () => {
  it("explains context overflows and truncation", () => {
    expect(llm.describeApiError(new budget.ContextOverflowError(900, 300, 1024)).status).toBe(413);
    expect(llm.describeApiError(new llm.OutputTruncatedError()).message).toMatch(/ran out of room/);
  });
});
