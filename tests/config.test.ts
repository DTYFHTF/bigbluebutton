import { afterEach, describe, expect, it, vi } from "vitest";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

async function loadConfig(env: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) if (key.startsWith("HUMANLY_") || key === "OLLAMA_CONTEXT_LENGTH") delete process.env[key];
  Object.assign(process.env, env);
  vi.resetModules();
  return (await import("@/lib/config")).config;
}

describe("judge configuration", () => {
  it("doesn't send a local model name to a hosted judge", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = await loadConfig({
      HUMANLY_PROVIDER: "ollama",
      HUMANLY_FAST_MODEL: "qwen3:4b-instruct",
      HUMANLY_JUDGE_MODEL: "qwen3:4b-instruct",
      HUMANLY_JUDGE_PROVIDER: "groq",
    });
    expect(config.judge.provider).toBe("groq");
    expect(config.judgeModel).toBe("llama-3.3-70b-versatile");
    expect(config.judge.numCtx).toBe(0);
  });

  it("keeps an explicit judge model on the same provider", async () => {
    const config = await loadConfig({ HUMANLY_PROVIDER: "ollama", HUMANLY_JUDGE_MODEL: "gemma4:12b" });
    expect(config.judgeModel).toBe("gemma4:12b");
    expect(config.judge.numCtx).toBe(4096);
  });
});

describe("context window", () => {
  it("honours OLLAMA_CONTEXT_LENGTH, and HUMANLY_NUM_CTX over it", async () => {
    expect((await loadConfig({ HUMANLY_PROVIDER: "ollama", OLLAMA_CONTEXT_LENGTH: "8192" })).main.numCtx).toBe(8192);
    expect((await loadConfig({ HUMANLY_PROVIDER: "ollama", OLLAMA_CONTEXT_LENGTH: "8192", HUMANLY_NUM_CTX: "16384" })).main.numCtx).toBe(16384);
    expect((await loadConfig({})).main.numCtx).toBe(0);
  });

  it("uses the full prompt and three drafts on Anthropic", async () => {
    const config = await loadConfig({});
    expect(config.promptProfile).toBe("full");
    expect(config.candidates).toBe(3);
  });
});
