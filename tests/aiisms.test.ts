import { describe, expect, it } from "vitest";
import { countEmDashes, findAiPhrases } from "@/lib/aiisms";

describe("findAiPhrases", () => {
  it("finds stock phrases with positions", () => {
    const text = "Let us delve into this. It's important to note that it plays a crucial role.";
    const hits = findAiPhrases(text);
    expect(hits.map((h) => h.phrase)).toEqual(["delve into", "It's important to note that", "plays a crucial role"]);
    for (const h of hits) expect(text.slice(h.start, h.end)).toBe(h.phrase);
  });

  it("does not report overlapping hits twice", () => {
    const hits = findAiPhrases("This is crucially important and plays a crucial role.");
    expect(hits.map((h) => h.phrase)).toEqual(["crucially", "plays a crucial role"]);
  });

  it("returns nothing for plain writing", () => {
    expect(findAiPhrases("We shipped the fix on Tuesday and it held up.")).toEqual([]);
  });

  it("matches learned phrases as whole words", () => {
    const extra = [{ phrase: "deep dive", suggestion: "close look" }, { phrase: "synergy", suggestion: "teamwork" }];
    const hits = findAiPhrases("A Deep  Dive into synergy, not synergyless deep diver.", extra);
    expect(hits.map((h) => h.phrase)).toEqual(["Deep  Dive", "synergy"]);
  });

  it("counts em dashes", () => {
    expect(countEmDashes("a — b — c")).toBe(2);
  });
});
