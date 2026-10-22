import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "humanly-judge-"));
process.env.HUMANLY_DATA_DIR = dir;
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const generateJson = vi.fn();
vi.mock("@/lib/llm", () => ({ generateJson: (...args: unknown[]) => generateJson(...args) }));

const { bestScored, candidateOrder, judge, normalizeLabel } = await import("@/lib/judge");
const { paraphraseRequestSchema } = await import("@/lib/prompt");

const req = paraphraseRequestSchema.parse({ text: "x", mode: "standard" });
const evaluation = (label: string, n: number) => ({ label, naturalness: n, meaning: 9, fluency: 9, mode_fit: 8, issues: [] });

beforeEach(() => generateJson.mockReset());

describe("normalizeLabel", () => {
  it("accepts the ways small models write labels", () => {
    expect(normalizeLabel("A")).toBe("A");
    expect(normalizeLabel(" b ")).toBe("B");
    expect(normalizeLabel("Candidate A")).toBe("A");
    expect(normalizeLabel("Draft C:")).toBe("C");
    expect(normalizeLabel("2")).toBe("B");
    expect(normalizeLabel("label")).toBe("");
  });
});

describe("candidateOrder", () => {
  it("is a stable permutation that depends on content, not position", () => {
    const order = candidateOrder(["one", "two", "three"]);
    expect([...order].sort()).toEqual([0, 1, 2]);
    expect(candidateOrder(["one", "two", "three"])).toEqual(order);
    const swapped = candidateOrder(["three", "two", "one"]);
    expect(swapped.map((i) => ["three", "two", "one"][i])).toEqual(order.map((i) => ["one", "two", "three"][i]));
  });
});

describe("judge", () => {
  it("maps labels back to candidates and marks missing ones unscored", async () => {
    const candidates = ["first draft", "second draft"];
    const order = candidateOrder(candidates);
    // The judge only scores whichever candidate it was shown as "A".
    generateJson.mockResolvedValue({ evaluations: [evaluation("Candidate A", 8)] });
    const result = await judge(req, "original", candidates);
    const shownFirst = order[0];
    expect(result[shownFirst].scores?.naturalness).toBe(8);
    expect(result[1 - shownFirst].scores).toBeNull();
    expect(generateJson.mock.calls[0][1].role).toBe("judge");
  });
});

describe("bestScored", () => {
  it("ignores unscored candidates", () => {
    const s = (overall: number) => ({ naturalness: 0, meaning: 0, fluency: 0, modeFit: 0, overall });
    expect(bestScored(null)).toBeNull();
    expect(bestScored([{ scores: null, issues: [] }])).toBeNull();
    expect(bestScored([{ scores: null, issues: [] }, { scores: s(5), issues: [] }, { scores: s(7), issues: [] }])).toBe(2);
  });
});
