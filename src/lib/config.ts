// Server-side settings, all overridable through environment variables.

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type ProviderId = "anthropic" | "ollama" | "nvidia" | "openrouter" | "groq" | "custom";
export type PromptProfile = "full" | "compact";

interface ProviderPreset {
  label: string;
  baseUrl: string | null;
  keyEnv: string;
  // Local servers don't need a key.
  keyOptional?: boolean;
  // One model for every role; override per role with HUMANLY_*_MODEL.
  model: string;
  // Pause between calls (ms) to stay under a free tier's per-minute cap.
  minIntervalMs: number;
}

// Model ids for the free providers are defaults, not guarantees: catalogues
// change, so set HUMANLY_*_MODEL if one is retired.
export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  anthropic: { label: "Anthropic", baseUrl: null, keyEnv: "ANTHROPIC_API_KEY", model: "claude-haiku-5-5", minIntervalMs: 0 },
  ollama: {
    label: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    keyEnv: "OLLAMA_API_KEY",
    keyOptional: true,
    model: "llama3.1:8b",
    minIntervalMs: 0,
  },
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

// Where one kind of call goes: the main provider (drafts, polish,
// alternatives, learner) or the judge's provider, which may differ.
export interface ProviderTarget {
  provider: ProviderId;
  label: string;
  // OpenAI-compatible providers only.
  baseUrl: string;
  apiKeyEnv: string;
  apiKeyOptional: boolean;
  minIntervalMs: number;
  // Context window in tokens to budget prompts against; 0 = don't budget.
  numCtx: number;
}

function num(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && process.env[name] !== "" && process.env[name] !== undefined ? value : fallback;
}

function optionalNum(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function providerId(raw: string | undefined, fallback: ProviderId): ProviderId {
  return raw && raw in PROVIDERS ? (raw as ProviderId) : fallback;
}

function target(id: ProviderId, baseUrlEnv: string, numCtxEnv: string): ProviderTarget {
  const preset = PROVIDERS[id];
  return {
    provider: id,
    label: preset.label,
    baseUrl: (process.env[baseUrlEnv] ?? preset.baseUrl ?? "").replace(/\/+$/, ""),
    apiKeyEnv: preset.keyEnv,
    apiKeyOptional: preset.keyOptional ?? false,
    minIntervalMs: num("HUMANLY_MIN_INTERVAL_MS", preset.minIntervalMs),
    // Ollama gives models a 4096-token window by default on machines with
    // less than 24 GB of VRAM, and its OpenAI-compatible API can't change it.
    // An over-long prompt is cut from the front, which drops the instructions.
    numCtx: num(numCtxEnv, id === "ollama" ? 4096 : 0),
  };
}

const mainId = providerId(process.env.HUMANLY_PROVIDER, "anthropic");
const judgeId = providerId(process.env.HUMANLY_JUDGE_PROVIDER, mainId);
const main = target(mainId, "HUMANLY_BASE_URL", "HUMANLY_NUM_CTX");
// A judge on another provider gets its own URL and window settings.
const judgeTarget = judgeId === mainId ? main : target(judgeId, "HUMANLY_JUDGE_BASE_URL", "HUMANLY_JUDGE_NUM_CTX");
const defaultModel = PROVIDERS[mainId].model;
const isAnthropic = mainId === "anthropic";
const isOllama = mainId === "ollama";

export const config = {
  main,
  judge: judgeTarget,
  // Shorthands for the main provider, used across the app.
  provider: main.provider,
  providerLabel: main.label,
  baseUrl: main.baseUrl,
  apiKeyEnv: main.apiKeyEnv,
  apiKeyOptional: main.apiKeyOptional,
  minIntervalMs: main.minIntervalMs,
  // Single-pass rewrites ("Fast" quality).
  fastModel: process.env.HUMANLY_FAST_MODEL ?? defaultModel,
  fastEffort: (process.env.HUMANLY_FAST_EFFORT ?? "low") as Effort,
  // Drafts and the final polish in "Best" quality.
  bestModel: process.env.HUMANLY_BEST_MODEL ?? defaultModel,
  bestEffort: (process.env.HUMANLY_BEST_EFFORT ?? "medium") as Effort,
  // Scores drafts. A judge on a stronger provider (HUMANLY_JUDGE_PROVIDER)
  // makes scores, Best's choices and evals far more trustworthy than a small
  // model grading its own writing.
  judgeModel: process.env.HUMANLY_JUDGE_MODEL ?? (judgeId === mainId ? defaultModel : PROVIDERS[judgeId].model),
  judgeEffort: (process.env.HUMANLY_JUDGE_EFFORT ?? "medium") as Effort,
  // "compact" is a short prompt with built-in examples, for small local
  // models that lose track of long rule lists.
  promptProfile: ((process.env.HUMANLY_PROMPT_PROFILE ?? (isOllama ? "compact" : "full")) === "compact"
    ? "compact"
    : "full") as PromptProfile,
  // Sampling for OpenAI-compatible providers. Anthropic never receives these.
  // HUMANLY_SAMPLING=off sends none of them (nor the Ollama extras below).
  sampling: process.env.HUMANLY_SAMPLING !== "off",
  // Unset = provider default (Ollama's /v1 uses 1.0). Not changed by default
  // until evals show a better value for a given model.
  draftTemperature: optionalNum("HUMANLY_DRAFT_TEMPERATURE"),
  // The judge should score the same text the same way every time.
  judgeTemperature: num("HUMANLY_JUDGE_TEMPERATURE", 0),
  judgeSeed: num("HUMANLY_JUDGE_SEED", 7),
  // Fixed seed for drafts, for reproducible evals; unset = random.
  seed: optionalNum("HUMANLY_SEED"),
  // Ollama only: keep the model loaded between requests, and switch off
  // "thinking" on reasoning models so a rewrite doesn't spend its tokens on it.
  keepAlive: process.env.HUMANLY_KEEP_ALIVE ?? "30m",
  think: process.env.HUMANLY_THINK === "on",
  // Number of competing drafts in "Best" quality. Hosted free tiers get fewer
  // so a rewrite stays within their request caps; a local model gets one,
  // because parallel requests compete for the same memory and slow it down.
  candidates: Math.max(1, Math.min(5, num("HUMANLY_CANDIDATES", isAnthropic ? 3 : isOllama ? 1 : 2))),
  // Quality preselected in the UI. Best chains 4+ model calls, which is slow on a laptop.
  defaultQuality: ((process.env.HUMANLY_DEFAULT_QUALITY ?? (isOllama ? "fast" : "best")) === "fast" ? "fast" : "best") as
    | "fast"
    | "best",
  // Retry once when a draft barely changed the wording (0 = off).
  nearCopyRetries: Math.max(0, Math.min(2, num("HUMANLY_NEAR_COPY_RETRIES", 1))),
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

// What produced a rewrite, stored with each run and eval row so results can
// be compared like for like.
export function runSetup(model: string) {
  return {
    provider: config.provider,
    model,
    judgeProvider: config.judge.provider,
    judgeModel: config.judgeModel,
    promptProfile: config.promptProfile,
  };
}
