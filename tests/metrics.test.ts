import { describe, expect, it } from "vitest";
import { copiedSentences, lexicalChange, missingNumbers, numbersIn, sentencesReworked, words } from "@/lib/metrics";

describe("words", () => {
  it("lowercases and keeps contractions and hyphenated words", () => {
    expect(words("It's a well-known Fact, isn’t it?")).toEqual(["it's", "a", "well-known", "fact", "isn't", "it"]);
  });
});

describe("lexicalChange", () => {
  it("ignores reordering", () => {
    expect(lexicalChange("Because it rained, we stayed home.", "We stayed home because it rained.")).toBe(0);
  });

  it("counts new words against the input's multiset", () => {
    expect(lexicalChange("the cat sat", "the dog sat")).toBeCloseTo(1 / 3);
    expect(lexicalChange("a", "a a")).toBe(0.5);
    expect(lexicalChange("x", "")).toBe(0);
  });
});

describe("sentencesReworked", () => {
  it("separates copied sentences from rebuilt ones", () => {
    const input = "The council approved the plan on Monday. Funding comes from grants.";
    const output = "The council approved the plan on Monday. Grants will pay for most of it, officials said.";
    expect(sentencesReworked(input, output)).toBe(0.5);
  });
});

describe("numbers", () => {
  it("normalises separators and spelled-out numbers", () => {
    expect(numbersIn("1,350 accounts, 18% growth, nine people, $4.2 million")).toEqual(["1350", "18", "4.2", "9"]);
  });

  it("reports digits that disappeared", () => {
    expect(missingNumbers("We hired 14 people and opened 2 offices.", "We hired fourteen people and opened two offices.")).toEqual([]);
    expect(missingNumbers("Revenue grew 18% to $4.2 million.", "Revenue grew strongly to $4.2 million.")).toEqual(["18"]);
    expect(missingNumbers("3 and 3", "3")).toEqual(["3"]);
  });
});

describe("number edge cases (review fixes)", () => {
  it("doesn't treat the pronoun 'one' as the number 1", () => {
    expect(missingNumbers("Only 1 office opened.", "No one opened an office.")).toEqual(["1"]);
    expect(missingNumbers("Only 1 office opened.", "Just one office opened.")).toEqual([]);
  });

  it("ignores leading zeros and reads compound number words", () => {
    expect(missingNumbers("Doors open at 09:00.", "Doors open at 9:00.")).toEqual([]);
    expect(missingNumbers("We saw a 23% rise.", "We saw a twenty-three percent rise.")).toEqual([]);
    expect(missingNumbers("A 30-hour week.", "A thirty-hour week.")).toEqual([]);
    expect(numbersIn("twenty three people")).toEqual(["23"]);
  });
});

describe("copiedSentences", () => {
  const input = "Our team grew to 14 people this year. We opened an office in Lisbon and hired two designers.";
  it("counts verbatim sentences, including in a padded copy", () => {
    expect(copiedSentences(input, input)).toBe(2);
    expect(copiedSentences(input, `${input} It was a great year for everyone involved.`)).toBe(2);
  });

  it("doesn't count a rewrite that reuses the content words", () => {
    expect(copiedSentences(input, "This year the team reached 14 people. A Lisbon office opened, and two designers joined us.")).toBe(0);
  });
});
