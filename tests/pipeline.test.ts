import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextOverflowError } from "@/lib/budget";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "humanly-pipeline-"));
process.env.HUMANLY_DATA_DIR = dir;
process.env.HUMANLY_PROVIDER = "ollama";
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

interface Call {
  user: string;
  system: string;
  history?: unknown[];
  role?: string;
}
const streamText = vi.fn();
const generateJson = vi.fn();
vi.mock("@/lib/llm", () => ({
  streamText: (req: Call, opts?: { onDelta?: (t: string) => void }) => streamText(req, opts),
  generateJson: (...args: unknown[]) => generateJson(...args),
}));

const { runPipeline, draftOnce } = await import("@/lib/pipeline");
const { paraphraseRequestSchema } = await import("@/lib/prompt");
const { config } = await import("@/lib/config");

const INPUT = "Our team grew to 14 people this year. We opened an office in Lisbon and hired two designers.";
const COPY = "Our team grew to 14 people this year. We opened an office in Lisbon and hired two designers.";
const FRESH = "This year the team reached 14 people. A Lisbon office opened, and two designers joined us.";
const FRESH_NO_NUMBER = "The team got much bigger this year. A Lisbon office opened, and two designers joined us.";

const req = (over: Record<string, unknown> = {}) =>
  paraphraseRequestSchema.parse({ text: INPUT, mode: "humanize", quality: "fast", ...over });

// The judge mock scores every candidate it is shown, by label.
function judgeAll(naturalness = 8, issues: unknown[] = []) {
  generateJson.mockImplementation(async (_schema: unknown, call: Call) => ({
    evaluations: [...call.user.matchAll(/<candidate label="(\w)">/g)].map(([, label]) => ({
      label,
      naturalness,
      meaning: 9,
      fluency: 9,
      mode_fit: 8,
      issues,
    })),
  }));
}

function events() {
  const list: Array<{ type: string; message?: string; text?: string }> = [];
  return { list, emit: (e: { type: string }) => list.push(e) };
}

beforeEach(() => {
  streamText.mockReset();
  generateJson.mockReset();
});

describe("config for a local model", () => {
  it("uses the compact prompt, one draft and a context budget", () => {
    expect(config.promptProfile).toBe("compact");
    expect(config.candidates).toBe(1);
    expect(config.main.numCtx).toBe(4096);
  });
});

describe("Fast quality", () => {
  it("retries a near-copy and keeps the more varied retry", async () => {
    streamText.mockResolvedValueOnce(COPY).mockResolvedValueOnce(FRESH);
    judgeAll();
    const { list, emit } = events();
    const result = await runPipeline(req(), { emit, persist: false });
    expect(result.output).toBe(FRESH);
    expect(result.detail).toMatch(/reworked/);
    expect(streamText.mock.calls[1][0].user).toMatch(/changed almost none of the wording/);
    expect(list.some((e) => e.type === "reset")).toBe(true);
    expect(result.metrics.lexicalChange).toBeGreaterThan(0.3);
    expect(result.scores?.naturalness).toBe(8);
  });

  it("rejects a retry that drops a number", async () => {
    streamText.mockResolvedValueOnce(COPY).mockResolvedValueOnce(FRESH_NO_NUMBER);
    judgeAll();
    const result = await runPipeline(req(), { persist: false });
    expect(result.output).toBe(COPY);
  });

  it("doesn't push Fluency mode to change more", async () => {
    streamText.mockResolvedValueOnce(COPY);
    judgeAll();
    const result = await runPipeline(req({ mode: "fluency" }), { persist: false });
    expect(streamText).toHaveBeenCalledTimes(1);
    expect(result.output).toBe(COPY);
  });

  it("still returns the rewrite when scoring fails", async () => {
    streamText.mockResolvedValueOnce(FRESH);
    generateJson.mockRejectedValue(new Error("bad json"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runPipeline(req(), { persist: false });
    expect(result.output).toBe(FRESH);
    expect(result.scores).toBeNull();
  });

  it("strips a preamble the model added", async () => {
    streamText.mockResolvedValueOnce(`Here is the rewritten text:\n\n${FRESH}`);
    judgeAll();
    expect((await runPipeline(req(), { persist: false })).output).toBe(FRESH);
  });

  it("sends the compact prompt with examples as chat turns and the task after the text", async () => {
    streamText.mockResolvedValueOnce(FRESH);
    judgeAll();
    await runPipeline(req(), { persist: false });
    const call = streamText.mock.calls[0][0];
    expect(call.system).toMatch(/^You rewrite text/);
    expect(call.history.length).toBeGreaterThan(0);
    expect(call.user).toMatch(/<\/text>\n\nNow rewrite the passage above in Humanize mode/);
  });
});

describe("variety retry (review fixes)", () => {
  it("keeps the first draft when the retry fails", async () => {
    streamText.mockResolvedValueOnce(COPY).mockRejectedValueOnce(new Error("HTTP 429"));
    judgeAll();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runPipeline(req(), { persist: false });
    expect(result.output).toBe(COPY);
    expect(result.detail).toBe("Single pass");
  });

  it("doesn't retry Shorten, which works by deleting words", async () => {
    streamText.mockResolvedValueOnce("Our team grew to 14 people. We opened in Lisbon and hired two designers.");
    judgeAll();
    await runPipeline(req({ mode: "shorten" }), { persist: false });
    expect(streamText).toHaveBeenCalledTimes(1);
  });

  it("accepts a proper expansion in Expand mode", async () => {
    const expanded =
      "This year our team reached 14 people, which is a big step for a small company. We set up a new office in Lisbon to be closer to clients there, and we brought on two designers to strengthen the product side.";
    streamText.mockResolvedValueOnce(COPY).mockResolvedValueOnce(expanded);
    judgeAll();
    const result = await runPipeline(req({ mode: "expand", synonyms: 5 }), { persist: false });
    expect(result.output).toBe(expanded);
  });

  it("rejects a retry that overshoots a low slider setting", async () => {
    const heavy = "Headcount: fourteen, up sharply. A Portuguese base launched. Two creatives were recruited. 14 total.";
    streamText.mockResolvedValueOnce(COPY).mockResolvedValueOnce(heavy);
    judgeAll();
    const result = await runPipeline(req({ synonyms: 1 }), { persist: false });
    expect(result.output).toBe(COPY);
    expect(streamText.mock.calls[1][0].user).toMatch(/change about 10% of the words/);
  });

  it("replaces an empty first draft", async () => {
    streamText.mockResolvedValueOnce("<text></text>").mockResolvedValueOnce(FRESH);
    judgeAll();
    expect((await runPipeline(req(), { persist: false })).output).toBe(FRESH);
  });
});

describe("Best quality", () => {
  it("adopts a variety retry only if it holds up against the judged draft", async () => {
    streamText.mockResolvedValueOnce(COPY).mockResolvedValueOnce(FRESH);
    // The retry loses meaning in the side-by-side check, so the judged draft stays.
    generateJson.mockImplementation(async (_s: unknown, c: Call) => ({
      evaluations: [...c.user.matchAll(/<candidate label="(\w)">\n([\s\S]*?)\n<\/candidate>/g)].map(([, label, text]) => ({
        label,
        // A perfect draft with no issues skips the polish step.
        naturalness: 10,
        meaning: text === FRESH ? 6 : 10,
        fluency: 10,
        mode_fit: 10,
        issues: [],
      })),
    }));
    const result = await runPipeline(req({ quality: "best" }), { persist: false });
    expect(result.output).toBe(COPY);
    expect(result.detail).not.toMatch(/reworked/);
  });

  it("ships the judged draft when the polish fails", async () => {
    streamText.mockResolvedValueOnce(FRESH).mockRejectedValueOnce(new Error("The model stopped before it finished"));
    judgeAll(7, [{ quote: "This year", problem: "flat", fix: "vary" }]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runPipeline(req({ quality: "best" }), { persist: false });
    expect(result.output).toBe(FRESH);
    expect(result.scores?.naturalness).toBe(7);
    expect(result.detail).toMatch(/polish failed/);
  });

  it("ships the draft unpolished when the judge fails", async () => {
    streamText.mockResolvedValueOnce(FRESH);
    generateJson.mockRejectedValue(new Error("judge down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runPipeline(req({ quality: "best" }), { persist: false });
    expect(result.output).toBe(FRESH);
    expect(result.scores).toBeNull();
    expect(result.detail).toMatch(/scoring unavailable/);
    expect(streamText).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft when the polish scores lower", async () => {
    const polished = "This year our headcount hit 14. We set up in Lisbon and brought on two designers.";
    streamText.mockResolvedValueOnce(FRESH).mockResolvedValueOnce(polished);
    let call = 0;
    generateJson.mockImplementation(async (_s: unknown, c: Call) => {
      call++;
      const labels = [...c.user.matchAll(/<candidate label="(\w)">\n([\s\S]*?)\n<\/candidate>/g)];
      return {
        evaluations: labels.map(([, label, text]) => ({
          label,
          // First call: the draft, with an issue to polish. Second: polish scores lower.
          naturalness: call === 1 ? 7 : text === polished ? 5 : 8,
          meaning: 9,
          fluency: 9,
          mode_fit: 8,
          issues: call === 1 ? [{ quote: "This year", problem: "flat", fix: "vary" }] : [],
        })),
      };
    });
    const result = await runPipeline(req({ quality: "best" }), { persist: false });
    expect(result.output).toBe(FRESH);
    expect(result.detail).toMatch(/kept the draft/);
  });
});

describe("draftOnce on a small context window", () => {
  it("drops examples, then rewrites paragraph by paragraph", async () => {
    // Each paragraph is about 1,400 estimated tokens, so only one fits per call
    // in a 4096-token window alongside the instructions and the output.
    const paragraphs = ["team", "Lisbon", "hiring"].map((topic) => `About ${topic}: ` + "Plenty of words here. ".repeat(210).trim());
    const text = paragraphs.join("\n\n");
    streamText.mockImplementation(async (call: Call) => {
      // Simulate a window that only fits one paragraph and no examples.
      if ((call.history?.length ?? 0) > 0 || paragraphs.filter((p) => call.user.includes(p)).length > 1) {
        throw new ContextOverflowError(5000, 200, 4096);
      }
      const p = paragraphs.find((x) => call.user.includes(x)) ?? "";
      return `Rewritten: ${p.slice(0, 20)}`;
    });
    const deltas: string[] = [];
    const out = await draftOnce(paraphraseRequestSchema.parse({ text, mode: "standard" }), {
      model: "m",
      effort: "low",
      guideRules: [],
      onDelta: (d) => deltas.push(d),
    });
    expect(out).toBe(paragraphs.map((p) => `Rewritten: ${p.slice(0, 20)}`).join("\n\n"));
    expect(deltas).toEqual(["\n\n", "\n\n"]);
  });
});
