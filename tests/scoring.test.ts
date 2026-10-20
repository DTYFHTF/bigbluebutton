import { describe, expect, it } from "vitest";
import { overallScore } from "@/lib/scoring";

const perfect = { naturalness: 10, meaning: 10, fluency: 10, modeFit: 10 };
const none = { robotic: 0, missingFrozen: 0 };

describe("overallScore", () => {
  it("is 10 for a perfect rewrite", () => {
    expect(overallScore(perfect, none)).toBe(10);
  });

  it("weights naturalness and meaning most", () => {
    const natural = overallScore({ ...perfect, naturalness: 6 }, none);
    const fluent = overallScore({ ...perfect, fluency: 6 }, none);
    expect(natural).toBeLessThan(fluent);
  });

  it("treats lost meaning as a gate", () => {
    const unfaithful = overallScore({ ...perfect, meaning: 4 }, none);
    const stiff = overallScore({ ...perfect, naturalness: 4 }, none);
    expect(unfaithful).toBeLessThan(stiff);
  });

  it("penalises robotic phrases and missing frozen terms", () => {
    expect(overallScore(perfect, { robotic: 2, missingFrozen: 0 })).toBeCloseTo(9.4);
    expect(overallScore(perfect, { robotic: 0, missingFrozen: 1 })).toBe(8);
  });

  it("clamps out-of-range ratings", () => {
    expect(overallScore({ naturalness: 50, meaning: 50, fluency: 50, modeFit: 50 }, none)).toBe(10);
    expect(overallScore({ naturalness: -5, meaning: NaN, fluency: 0, modeFit: 0 }, none)).toBe(0);
  });
});
