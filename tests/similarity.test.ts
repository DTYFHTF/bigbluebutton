import { describe, expect, it } from "vitest";
import { rankBySimilarity, terms } from "@/lib/similarity";

describe("terms", () => {
  it("lowercases and drops stopwords", () => {
    expect(terms("The Cat and the HAT")).toEqual(["cat", "hat"]);
  });
});

describe("rankBySimilarity", () => {
  it("ranks the most similar document first", () => {
    const docs = ["quarterly sales report for the board", "how to bake sourdough bread", "sales numbers fell this quarter"];
    const ranked = rankBySimilarity("baking bread with sourdough starter", docs, (d) => d);
    expect(ranked[0].doc).toBe("how to bake sourdough bread");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});
