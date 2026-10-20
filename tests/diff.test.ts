import { describe, expect, it } from "vitest";
import { changedRatio, diffWords, tokenize } from "@/lib/diff";

describe("tokenize", () => {
  it("round-trips the original text", () => {
    const text = "  Hello, world!\n\nThis is  fine. ";
    expect(tokenize(text).join("")).toBe(text);
  });
});

describe("diffWords", () => {
  it("marks nothing when texts match apart from case and punctuation", () => {
    const tokens = diffWords("The cat sat.", "the cat sat");
    expect(tokens.every((t) => !t.changed)).toBe(true);
  });

  it("marks only new words", () => {
    const tokens = diffWords("The cat sat on the mat.", "The dog sat on the rug.");
    expect(tokens.filter((t) => t.changed).map((t) => t.text.trim())).toEqual(["dog", "rug."]);
    expect(tokens.map((t) => t.text).join("")).toBe("The dog sat on the rug.");
  });

  it("computes the share of changed words", () => {
    expect(changedRatio(diffWords("a b c d", "a b x y"))).toBe(0.5);
    expect(changedRatio([])).toBe(0);
  });
});
