import { describe, expect, it } from "vitest";
import {
  buildRefineMessage,
  buildSystemPrompt,
  buildUserMessage,
  missingFrozenTerms,
  paraphraseRequestSchema,
} from "@/lib/prompt";

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
