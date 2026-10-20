// Server-side settings, all overridable through environment variables.

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

function num(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && process.env[name] !== "" && process.env[name] !== undefined ? value : fallback;
}

export const config = {
  // Single-pass rewrites ("Fast" quality).
  fastModel: process.env.HUMANLY_FAST_MODEL ?? "claude-haiku-5-5",
  fastEffort: (process.env.HUMANLY_FAST_EFFORT ?? "low") as Effort,
  // Drafts and the final polish in "Best" quality.
  bestModel: process.env.HUMANLY_BEST_MODEL ?? "claude-haiku-5-5",
  bestEffort: (process.env.HUMANLY_BEST_EFFORT ?? "medium") as Effort,
  // Scores drafts. Using a different model from the drafter (e.g. claude-opus-5-5)
  // avoids the judge favouring its own writing.
  judgeModel: process.env.HUMANLY_JUDGE_MODEL ?? "claude-haiku-5-5",
  judgeEffort: (process.env.HUMANLY_JUDGE_EFFORT ?? "medium") as Effort,
  // Number of competing drafts in "Best" quality.
  candidates: Math.max(1, Math.min(5, num("HUMANLY_CANDIDATES", 3))),
  // 0 disables the cap / the limiter.
  maxWords: num("HUMANLY_MAX_WORDS", 0),
  rateLimitPerMin: num("HUMANLY_RATE_LIMIT_PER_MIN", 0),
  // Where runs, feedback and learned style guides are stored.
  dataDir: process.env.HUMANLY_DATA_DIR ?? "./data",
  // Run the learner automatically after this many new pieces of feedback (0 = never).
  autoLearnEvery: num("HUMANLY_AUTO_LEARN_EVERY", 10),
  // A new style guide is adopted unless it lowers the eval score by more than this.
  learnTolerance: num("HUMANLY_LEARN_TOLERANCE", 0.15),
};
