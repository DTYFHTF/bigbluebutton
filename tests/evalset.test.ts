import { describe, expect, it } from "vitest";
import { loadEvalPassages, mapLimit, rotatingSlice } from "@/lib/evalset";
import { MODE_IDS } from "@/lib/modes";

describe("eval passages", () => {
  it("are valid and unique", () => {
    const passages = loadEvalPassages();
    expect(passages.length).toBeGreaterThanOrEqual(10);
    expect(new Set(passages.map((p) => p.id)).size).toBe(passages.length);
    for (const p of passages) {
      expect(MODE_IDS).toContain(p.mode);
      expect(p.text.length).toBeGreaterThan(100);
    }
  });
});

describe("rotatingSlice", () => {
  it("wraps around", () => {
    expect(rotatingSlice([1, 2, 3, 4], 3, 3)).toEqual([4, 1, 2]);
    expect(rotatingSlice([1, 2], 5, 1)).toEqual([1, 2]);
  });
});

describe("mapLimit", () => {
  it("keeps order and caps concurrency", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 3, 2], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, n));
      active--;
      return n * 2;
    });
    expect(out).toEqual([10, 2, 6, 4]);
    expect(peak).toBe(2);
  });
});
