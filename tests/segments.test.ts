import { describe, expect, it } from "vitest";
import { buildSegments } from "@/lib/segments";

describe("buildSegments", () => {
  it("groups tokens into sentences that rebuild the output", () => {
    const output = "First one here. Second is 3.5 long! Third\nFourth.";
    const segments = buildSegments("First one here.", output);
    const texts = segments.map((s) => output.slice(s.start, s.end));
    expect(texts.join("")).toBe(output);
    expect(texts.map((t) => t.trim())).toEqual(["First one here.", "Second is 3.5 long!", "Third", "Fourth."]);
    expect(segments[0].tokens.some((t) => t.changed)).toBe(false);
    expect(segments[1].tokens.every((t) => t.changed)).toBe(true);
  });
});
