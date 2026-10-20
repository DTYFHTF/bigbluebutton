// Server-side settings, all overridable through environment variables.

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type ProviderId = "anthropic" | "nvidia" | "openrouter" | "groq" | "custom";

interface ProviderPreset {
  label: string;
  baseUrl: string | null;
  keyEnv: string;
  // One model for every role; override per role with HUMANLY_*_MODEL.
  model: string;
  // Pause between calls (ms) to stay under a free tier's per-minute cap.
  minIntervalMs: number;
}

// Model ids for the free providers are defaults, not guarantees: catalogues
// change, so set HUMANLY_*_MODEL if one is retired.
export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  anthropic: { label: "Anthropic", baseUrl: null, keyEnv: "ANTHROPIC_API_KEY", model: "claude-haiku-5-5", minIntervalMs: 0 },
  nvidia: {
    label: "NVIDIA",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    keyEnv: "NVIDIA_API_KEY",
    model: "meta/llama-3.3-70b-instruct",
    minIntervalMs: 1600,
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    minIntervalMs: 3200,
  },
  groq: {
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
    model: "llama-3.3-70b-versatile",
    minIntervalMs: 2200,
  },
  custom: { label: "Custom", baseUrl: null, keyEnv: "HUMANLY_API_KEY", model: "", minIntervalMs: 0 },
};

function num(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && process.env[name] !== "" && process.env[name] !== undefined ? value : fallback;
}

const requested = process.env.HUMANLY_PROVIDER ?? "anthropic";
const providerId: ProviderId = requested in PROVIDERS ? (requested as ProviderId) : "anthropic";
const preset = PROVIDERS[providerId];
const defaultModel = preset.model;
// Only Anthropic models take an effort setting.
const isAnthropic = providerId === "anthropic";

export const config = {
  provider: providerId,
  providerLabel: preset.label,
  // OpenAI-compatible providers only.
  baseUrl: (process.env.HUMANLY_BASE_URL ?? preset.baseUrl ?? "").replace(/\/+$/, ""),
  apiKeyEnv: preset.keyEnv,
  minIntervalMs: num("HUMANLY_MIN_INTERVAL_MS", preset.minIntervalMs),
  // Single-pass rewrites ("Fast" quality).
  fastModel: process.env.HUMANLY_FAST_MODEL ?? defaultModel,
  fastEffort: (process.env.HUMANLY_FAST_EFFORT ?? "low") as Effort,
  // Drafts and the final polish in "Best" quality.
  bestModel: process.env.HUMANLY_BEST_MODEL ?? defaultModel,
  bestEffort: (process.env.HUMANLY_BEST_EFFORT ?? "medium") as Effort,
  // Scores drafts. Using a different model from the drafter avoids the judge
  // favouring its own writing.
  judgeModel: process.env.HUMANLY_JUDGE_MODEL ?? defaultModel,
  judgeEffort: (process.env.HUMANLY_JUDGE_EFFORT ?? "medium") as Effort,
  // Number of competing drafts in "Best" quality. Free tiers get fewer by
  // default so a rewrite stays within their request caps.
  candidates: Math.max(1, Math.min(5, num("HUMANLY_CANDIDATES", isAnthropic ? 3 : 2))),
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
