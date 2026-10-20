import { describe, expect, it } from "vitest";
import { countWords, sentenceRhythm, splitSentences } from "@/lib/text";

describe("countWords", () => {
  it("counts whitespace-separated words", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  one two\nthree  ")).toBe(3);
  });
});

describe("splitSentences", () => {
  it("splits on terminal punctuation and keeps the text intact", () => {
    const text = "It costs 3.5 dollars. Really? Yes!\nNew line here";
    const parts = splitSentences(text);
    expect(parts.map((p) => p.text.trim())).toEqual(["It costs 3.5 dollars.", "Really?", "Yes!", "New line here"]);
    expect(parts.map((p) => p.text).join("")).toBe(text);
  });

  it("handles closing quotes after punctuation", () => {
    const parts = splitSentences('She said "go." Then left.');
    expect(parts.map((p) => p.text.trim())).toEqual(['She said "go."', "Then left."]);
  });
});

describe("sentenceRhythm", () => {
  it("reports zero spread for uniform sentences", () => {
    expect(sentenceRhythm("One two three. Four five six.").stdev).toBe(0);
  });

  it("reports spread for mixed sentences", () => {
    const r = sentenceRhythm("Short. This one is a fair bit longer than that.");
    expect(r.count).toBe(2);
    expect(r.stdev).toBeGreaterThan(3);
  });
});
