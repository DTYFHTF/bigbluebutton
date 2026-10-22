import { describe, expect, it } from "vitest";
import { budgetFor, chunkText, estimateTokens, joinChunks } from "@/lib/budget";

describe("budget", () => {
  it("estimates conservatively and subtracts the prompt from the window", () => {
    expect(estimateTokens("abcdefghij")).toBe(4);
    const b = budgetFor({ system: "x".repeat(330), user: "y".repeat(330) }, 4096);
    expect(b.promptTokens).toBe(100 + 100 + 16);
    expect(b.available).toBe(4096 - 216 - 96);
  });
});

describe("chunkText", () => {
  const para = (n: number, tag: string) =>
    Array.from({ length: n }, (_, i) => `Sentence ${tag}${i} costs 3.5 dollars and is long enough.`).join(" ");

  it("keeps short text in one chunk", () => {
    expect(chunkText("One.\n\nTwo.", 100)).toEqual([{ separator: "", text: "One.\n\nTwo." }]);
  });

  it("splits between paragraphs and rejoins exactly", () => {
    const text = [para(3, "a"), para(3, "b"), para(3, "c")].join("\n\n");
    const chunks = chunkText(text, estimateTokens(para(3, "a")) + 5);
    expect(chunks.length).toBe(3);
    expect(chunks.map((c) => c.separator)).toEqual(["", "\n\n", "\n\n"]);
    expect(joinChunks(chunks)).toBe(text);
  });

  it("splits an over-long paragraph between sentences without breaking decimals", () => {
    const text = para(12, "x");
    const max = 60;
    const chunks = chunkText(text, max);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(estimateTokens(c.text)).toBeLessThanOrEqual(max);
    expect(chunks.slice(1).every((c) => c.separator === " ")).toBe(true);
    expect(joinChunks(chunks)).toBe(text);
    expect(chunks.every((c) => !/3\.\s|^5 dollars/.test(c.text))).toBe(true);
  });
});

describe("chunkText without sentence punctuation (review fix)", () => {
  it("splits at clauses or spaces and rejoins exactly", () => {
    const text = Array.from({ length: 80 }, (_, i) => `item ${i}, with a note`).join("; ");
    const chunks = chunkText(text, 50);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(estimateTokens(c.text)).toBeLessThanOrEqual(50);
    expect(joinChunks(chunks)).toBe(text);
    const noSpaces = "x".repeat(600);
    expect(joinChunks(chunkText(noSpaces, 50))).toBe(noSpaces);
  });
});
