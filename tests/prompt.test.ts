import { describe, expect, it } from "vitest";
import {
  buildRefineMessage,
  buildSystemPrompt,
  buildUserMessage,
  changeTarget,
  exampleTurns,
  missingFrozenTerms,
  paraphraseRequestSchema,
  taskReminder,
} from "@/lib/prompt";
import { allExemplars } from "@/lib/exemplars";
import { loadEvalPassages } from "@/lib/evalset";

const base = paraphraseRequestSchema.parse({ text: "Hello there.", mode: "humanize" });

describe("paraphraseRequestSchema", () => {
  it("applies defaults", () => {
    expect(base).toMatchObject({ quality: "best", synonyms: 3, dialect: "en-US", frozen: [] });
  });

  it("rejects empty text and unknown modes", () => {
    expect(paraphraseRequestSchema.safeParse({ text: "  ", mode: "humanize" }).success).toBe(false);
    expect(paraphraseRequestSchema.safeParse({ text: "hi", mode: "nope" }).success).toBe(false);
  });
});

describe("buildSystemPrompt", () => {
  it("includes mode, dialect and frozen terms", () => {
    const prompt = buildSystemPrompt({ ...base, dialect: "en-GB", frozen: ["Acme Cloud"] });
    expect(prompt).toContain("Mode: Humanize");
    expect(prompt).toContain("British English");
    expect(prompt).toContain('"Acme Cloud"');
  });

  it("adds the custom tone only in custom mode", () => {
    expect(buildSystemPrompt({ ...base, mode: "custom", customTone: "pirate" })).toContain("pirate");
    expect(buildSystemPrompt({ ...base, customTone: "pirate" })).not.toContain("pirate");
  });

  it("omits the vocabulary rule in fluency mode", () => {
    expect(buildSystemPrompt({ ...base, mode: "fluency" })).not.toContain("Vocabulary change");
  });

  it("does not put user text in the system prompt", () => {
    expect(buildSystemPrompt(base)).not.toContain("Hello there.");
    expect(buildUserMessage("Hello there.")).toBe("<text>\nHello there.\n</text>");
  });
});

describe("learned guide, angles and examples", () => {
  it("adds guide rules and the draft angle", () => {
    const prompt = buildSystemPrompt(base, { guideRules: ["Never use 'utilize'."], angle: "Approach: be brief." });
    expect(prompt).toContain("- Never use 'utilize'.");
    expect(prompt).toContain("Approach: be brief.");
    expect(buildSystemPrompt(base, { guideRules: [] })).not.toContain("Style guide");
  });

  it("puts examples before the passage", () => {
    const msg = buildUserMessage("New text.", [{ input: "Old.", output: "Older." }]);
    expect(msg.indexOf("<examples>")).toBeLessThan(msg.indexOf("<text>"));
    expect(msg).toContain("<rewrite>\nOlder.\n</rewrite>");
    expect(msg.endsWith("<text>\nNew text.\n</text>")).toBe(true);
  });

  it("formats refine notes", () => {
    expect(buildRefineMessage("O", "D", ["fix x"])).toContain("<editor_notes>\n- fix x\n</editor_notes>");
  });
});

describe("missingFrozenTerms", () => {
  it("reports frozen terms present in input but lost in output", () => {
    expect(missingFrozenTerms("Use Acme and Zed.", "Use Acme and Zee.", ["Acme", "Zed", "Other"])).toEqual(["Zed"]);
  });
});

describe("prompt profiles", () => {
  it("full Humanize no longer tells the model to leave sentences plain", () => {
    const prompt = buildSystemPrompt(base);
    expect(prompt).not.toMatch(/leaves some sentences plain/);
    expect(prompt).toContain("Change about 35% of the words");
  });

  it("compact profile is short, positive and carries the essentials", () => {
    const req = { ...base, frozen: ["Acme Cloud"], synonyms: 4 };
    const prompt = buildSystemPrompt(req, { profile: "compact", guideRules: Array.from({ length: 12 }, (_, i) => `rule ${i}`) });
    expect(prompt.length).toBeLessThan(buildSystemPrompt(req).length / 2);
    expect(prompt).toContain("change about half of the words");
    expect(prompt).toContain('"Acme Cloud"');
    expect(prompt).not.toMatch(/delve|tapestry/);
    expect(prompt.match(/^Also:/gm)).toHaveLength(8);
  });

  it("fluency has no change target", () => {
    expect(buildSystemPrompt({ ...base, mode: "fluency" }, { profile: "compact" })).not.toContain("Wording:");
    expect(taskReminder({ ...base, mode: "fluency" })).not.toContain("Change");
  });

  it("maps slider levels to targets", () => {
    expect([1, 2, 3, 4, 5].map(changeTarget)).toEqual(["about 10%", "about 20%", "about 35%", "about half", "two thirds or more"]);
  });

  it("repeats the task after the passage", () => {
    const msg = buildUserMessage("Hello.", [], taskReminder(base));
    expect(msg.startsWith("<text>\nHello.\n</text>\n\nNow rewrite the passage above in Humanize mode.")).toBe(true);
  });

  it("formats examples as chat turns", () => {
    expect(exampleTurns([{ input: "a", output: "b" }])).toEqual([
      { role: "user", content: "<text>\na\n</text>" },
      { role: "assistant", content: "b" },
    ]);
  });

  it("keeps built-in examples out of the eval set", () => {
    const evalTexts = loadEvalPassages().map((p) => p.text);
    for (const e of allExemplars()) {
      expect(evalTexts.some((t) => t.includes(e.input.slice(0, 40)))).toBe(false);
    }
  });
});
