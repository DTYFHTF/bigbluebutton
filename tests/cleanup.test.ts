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

describe("cleanOutput regressions found in review", () => {
  it("keeps a real first paragraph that starts like a chat reply", () => {
    const input = "Sure, the meeting is on Monday and everyone from the design team should attend.";
    const out = "Sure, the meeting is on Monday.\n\nEveryone from the design team should attend.";
    expect(cleanOutput(input, out)).toBe(out);
    const lead = "Here's what we learned from the textbooks:\n\nThey cover the basics well.";
    expect(cleanOutput("We learned that the textbooks cover the basics well.", lead)).toBe(lead);
  });

  it("keeps real closing lines that mention changes or tone", () => {
    const input = "The rota moves to Monday. Let me know if the change affects your plans.";
    const out = "The rota now starts on Monday.\n\nLet me know if the change affects your plans.";
    expect(cleanOutput(input, out)).toBe(out);
    const memo = "We hit the milestone. Notes: keep the tone of the launch email friendly.";
    const memoOut = "We reached the milestone.\n\nNotes: keep the launch email's tone friendly.";
    expect(cleanOutput(memo, memoOut)).toBe(memoOut);
  });

  it("keeps a closing paragraph that carries a number from the input", () => {
    const input = "Budget is $1.8 million. This version of the plan is final.";
    const out = "The budget stands at $1.8 million.\n\nThis version of the plan, at 1.8 million, is final.";
    expect(cleanOutput(input, out)).toBe(out);
  });

  it("still strips chat wrappers", () => {
    expect(cleanOutput("The cat sat.", "Sure! Here's a more natural version:\n\nThe cat was sitting.")).toBe("The cat was sitting.");
    expect(cleanOutput("The cat sat.", "The cat was sitting.\n\nLet me know if you'd like any further changes.")).toBe("The cat was sitting.");
    expect(cleanOutput("The cat sat.", "The cat was sitting.\n\nThis version keeps the original meaning.")).toBe("The cat was sitting.");
  });

  it("doesn't strip when the input already had that many lines", () => {
    const input = "Dear Sam,\nThe cat sat.\nBest,\nJo";
    const out = "Sure, here is the rewritten text:\n\nDear Sam,\nThe cat was sitting.";
    expect(cleanOutput(input, out)).toBe(out);
  });
});
