import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "humanly-test-"));
process.env.HUMANLY_DATA_DIR = dir;

type Store = typeof import("@/lib/store");
type Examples = typeof import("@/lib/examples");
let store: Store;
let examples: Examples;

beforeAll(async () => {
  store = await import("@/lib/store");
  examples = await import("@/lib/examples");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function run(id: string, input: string, output: string, mode: "humanize" | "formal" = "humanize") {
  store.saveRun({
    id,
    createdAt: Date.now(),
    mode,
    quality: "best",
    options: {},
    input,
    output,
    scores: { naturalness: 8, meaning: 9, fluency: 9, modeFit: 9, overall: 8.5 },
    guideVersion: null,
  });
}

describe("store", () => {
  it("records feedback and queues it for learning", () => {
    run("r1", "Our sales went up a lot this quarter.", "Sales rose sharply this quarter.");
    expect(store.countPendingFeedback()).toBe(0);
    expect(store.recordFeedback("r1", { rating: 1, note: "good" })).toBe(true);
    expect(store.countPendingFeedback()).toBe(1);
    store.markUsedInLearning(["r1"]);
    expect(store.countPendingFeedback()).toBe(0);
    expect(store.recordFeedback("missing", { rating: 1 })).toBe(false);
  });

  it("ignores a final output identical to the generated one", () => {
    run("r2", "Input two.", "Output two.");
    store.recordFeedback("r2", { finalOutput: "Output two." });
    expect(store.getRun("r2")?.finalOutput).toBeNull();
    store.recordFeedback("r2", { finalOutput: "Output two, edited." });
    expect(store.getRun("r2")?.finalOutput).toBe("Output two, edited.");
  });

  it("keeps one active guide at a time", () => {
    const v1 = store.saveGuide({ rules: ["a"], status: "active", evalScore: 7, baselineScore: 6.9, summary: "" });
    store.saveGuide({ rules: ["b"], status: "rejected", evalScore: 5, baselineScore: 7, summary: "" });
    expect(store.activeGuide()?.version).toBe(v1);
    const v3 = store.saveGuide({ rules: ["c"], status: "manual", evalScore: null, baselineScore: null, summary: "" });
    expect(store.activeGuide()).toMatchObject({ version: v3, rules: ["c"] });
    expect(store.listGuides().find((g) => g.version === v1)?.status).toBe("retired");
  });

  it("stores learned phrases normalised", () => {
    store.addPhrases([{ phrase: "  Deep Dive ", suggestion: "close look" }, { phrase: "x", suggestion: "too short" }]);
    expect(store.learnedPhrases().map((p) => p.phrase)).toEqual(["deep dive"]);
    store.removePhrase("deep dive");
    expect(store.learnedPhrases()).toEqual([]);
  });

  it("reports stats", () => {
    expect(store.stats()).toMatchObject({ runs: 2, liked: 1, edited: 1 });
  });
});

describe("pickExamples", () => {
  it("prefers similar approved rewrites and uses the user's edit", () => {
    run("e1", "The team baked sourdough bread for the bake sale.", "We baked sourdough for the bake sale.");
    store.recordFeedback("e1", { finalOutput: "We made sourdough for the bake sale." });
    run("e2", "Quarterly revenue numbers were reviewed by the board.", "The board went over the quarterly revenue.");
    store.recordFeedback("e2", { rating: 1 });
    run("e3", "Disliked rewrite about bread.", "Bad.");
    store.recordFeedback("e3", { rating: -1 });
    run("e4", "Formal bread text.", "Formal.", "formal");
    store.recordFeedback("e4", { rating: 1 });

    const picked = examples.pickExamples("humanize", "How to bake a sourdough bread loaf", 2);
    expect(picked[0]).toEqual({
      input: "The team baked sourdough bread for the bake sale.",
      output: "We made sourdough for the bake sale.",
    });
    expect(picked.map((e) => e.input)).not.toContain("Disliked rewrite about bread.");
    expect(picked.map((e) => e.input)).not.toContain("Formal bread text.");
  });
});
