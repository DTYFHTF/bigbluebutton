import { describe, expect, it } from "vitest";
import { cleanOutput } from "@/lib/cleanup";

describe("cleanOutput", () => {
  it("strips a chatty preamble the input didn't have", () => {
    expect(cleanOutput("The cat sat.", "Here is the rewritten text:\n\nThe cat was sitting.")).toBe("The cat was sitting.");
    expect(cleanOutput("The cat sat.", "Sure! Here's a more natural version.\n\nThe cat was sitting.")).toBe("The cat was sitting.");
  });

  it("keeps a first line that is real content", () => {
    const out = "Here are the results:\n\nSales went up.";
    expect(cleanOutput("Results: sales rose.", out)).toBe(out);
  });

  it("strips a trailing note about the rewrite, and a rule line before it", () => {
    const out = "The cat was sitting.\n\n---\n\nNote: I kept the original meaning and changed the tone.";
    expect(cleanOutput("The cat sat.", out)).toBe("The cat was sitting.");
  });

  it("keeps real closing lines", () => {
    const email = "Hi Sam,\n\nThe deck is ready.\n\nI have attached the slides.";
    const rewrite = "Hi Sam,\n\nThe deck is done.\n\nI have attached the slides.";
    expect(cleanOutput(email, rewrite)).toBe(rewrite);
    const memo = "The office moves on Monday.";
    const memoOut = "We move offices on Monday.\n\nNote that the office closes at 5.";
    expect(cleanOutput(memo, memoOut)).toBe(memoOut);
  });

  it("removes echoed tags and wrapping quotes", () => {
    expect(cleanOutput("The cat sat.", "<text>\nThe cat was sitting.\n</text>")).toBe("The cat was sitting.");
    expect(cleanOutput("The cat sat.", '"The cat was sitting."')).toBe("The cat was sitting.");
    expect(cleanOutput("The cat sat.", "“The cat was sitting.”")).toBe("The cat was sitting.");
  });

  it("keeps quotes that are part of the text", () => {
    expect(cleanOutput('"Go," she said.', '"Leave," she told him.')).toBe('"Leave," she told him.');
    expect(cleanOutput("He said hi.", '"Hi" he said, and "bye" too."')).toBe('"Hi" he said, and "bye" too."');
  });
});
