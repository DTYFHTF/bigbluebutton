// Checks that Humanly can run on this machine, fixes what it safely can, and
// runs a real rewrite as a smoke test.
//
//   npm run doctor                 # check and run a test rewrite
//   npm run doctor -- --fix        # also start Ollama and write .env.local
//   npm run doctor -- --fix --pull # also download a model if none is installed
//   npm run doctor -- --text "Some text to rewrite"

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    fix: { type: "boolean", default: false },
    pull: { type: "boolean", default: false },
    quality: { type: "string", default: "fast" },
    text: { type: "string" },
    "env-path": { type: "string", default: ".env.local" },
  },
});

const ENV_FILE = values["env-path"] as string;
const SAMPLE =
  values.text ??
  "In today's fast-paced digital landscape, effective communication plays a crucial role in the success of any organization. It's important to note that teams who leverage collaborative tools can navigate remote work more seamlessly.";
const MIN_PULL_BYTES = 6 * 1024 ** 3;
const PREFERRED = ["qwen3.5", "qwen3", "gemma4", "ministral-3", "llama3.1", "llama3.2", "llama3", "qwen2.5", "gemma", "mistral", "phi4", "phi3"];

interface Recommendation {
  tag: string;
  gb: number;
  note: string;
}

// Picks for rewriting by unified memory, from tags verified in the Ollama
// library (late 2026). macOS lets the GPU use about two thirds of RAM, so an
// 8 GB Mac should stay near 4 GB of weights.
function recommendations(ramGb: number): Recommendation[] {
  if (ramGb <= 12) {
    return [
      { tag: "qwen3:4b-instruct-2507-q4_K_M", gb: 2.5, note: "fast, follows instructions well, no 'thinking' step" },
      { tag: "qwen3.5:4b", gb: 4.0, note: "newer; thinking is switched off automatically" },
      { tag: "gemma4:e2b-it-qat", gb: 4.3, note: "natural-sounding prose" },
      { tag: "ministral-3:3b", gb: 3.0, note: "a different voice" },
    ];
  }
  if (ramGb <= 20) {
    return [
      { tag: "qwen3.5:9b", gb: 7.6, note: "strong instruction following" },
      { tag: "gemma4:e4b-it-qat", gb: 6.1, note: "natural-sounding prose" },
      { tag: "gemma4:12b-it-qat", gb: 7.2, note: "best prose that fits 16 GB" },
      { tag: "ministral-3:8b", gb: 6.0, note: "a different voice" },
    ];
  }
  return [
    { tag: "gemma4:12b", gb: 8.0, note: "best prose quality here" },
    { tag: "qwen3.5:9b", gb: 7.6, note: "strong instruction following" },
    { tag: "ministral-3:14b", gb: 9.1, note: "a different voice" },
  ];
}

// Models that work but rewrite noticeably worse than the picks above.
const WEAK = /^(phi3|phi-3|llama3\.2:1b|qwen2\.5:0\.5b)/i;

function freeDiskBytes(): number {
  try {
    const s = fs.statfsSync(os.homedir());
    return s.bavail * s.bsize;
  } catch {
    return Infinity;
  }
}

let failures = 0;
const ok = (msg: string) => console.log(`  ok    ${msg}`);
const warn = (msg: string) => console.log(`  warn  ${msg}`);
const bad = (msg: string, hint?: string) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
  if (hint) console.log(`        -> ${hint}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Writes KEY=value lines into the env file, replacing existing ones.
function setEnv(entries: Record<string, string>) {
  const existing = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8").split("\n") : [];
  const remaining = { ...entries };
  const lines = existing.map((line) => {
    const key = line.split("=")[0].trim();
    if (key in remaining) {
      const next = `${key}=${remaining[key]}`;
      delete remaining[key];
      return next;
    }
    return line;
  });
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  for (const [k, v] of Object.entries(remaining)) lines.push(`${k}=${v}`);
  fs.writeFileSync(ENV_FILE, lines.join("\n") + "\n");
  for (const [k, v] of Object.entries(entries)) process.env[k] = v;
}

async function tags(base: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return null;
  }
}

const installed = (names: string[], model: string) =>
  names.some((n) => n === model || n === `${model}:latest` || (!model.includes(":") && n.startsWith(`${model}:`)));

function pickInstalled(names: string[]): string | null {
  const chat = names.filter((n) => !/embed/i.test(n));
  for (const prefix of PREFERRED) {
    const hit = chat.find((n) => n.toLowerCase().startsWith(prefix));
    if (hit) return hit;
  }
  return chat[0] ?? null;
}

async function checkOllama() {
  const base = (process.env.HUMANLY_BASE_URL ?? "http://127.0.0.1:11434/v1").replace(/\/v1\/?$/, "").replace(/\/+$/, "");
  const bin = spawnSync("ollama", ["--version"], { encoding: "utf8" });
  if (bin.error) {
    bad(
      "The `ollama` command was not found.",
      "Install Ollama from ollama.com/download, open it once, then open a new Terminal window.",
    );
  } else {
    ok(`ollama CLI present (${(bin.stderr + bin.stdout).match(/\d+\.\d+\.\d+/)?.[0] ?? "version unknown"})`);
  }

  let names = await tags(base);
  if (!names) {
    if (values.fix && process.platform === "darwin") {
      console.log("        starting the Ollama app...");
      spawnSync("open", ["-a", "Ollama"]);
      for (let i = 0; i < 20 && !names; i++) {
        await sleep(1500);
        names = await tags(base);
      }
    } else if (values.fix && !bin.error) {
      console.log("        starting `ollama serve` in the background...");
      spawnSync("sh", ["-c", "nohup ollama serve >/dev/null 2>&1 &"]);
      for (let i = 0; i < 20 && !names; i++) {
        await sleep(1500);
        names = await tags(base);
      }
    }
  }
  if (!names) {
    bad(`Nothing is answering at ${base}.`, "Open the Ollama app (or run `ollama serve`), or re-run with --fix.");
    return;
  }
  ok(`Ollama server is running (${names.length} model${names.length === 1 ? "" : "s"} installed: ${names.join(", ") || "none"})`);

  // Disk space matters because a pull needs several GB.
  try {
    const s = fs.statfsSync(os.homedir());
    const free = s.bavail * s.bsize;
    const gb = (free / 1024 ** 3).toFixed(1);
    if (free < MIN_PULL_BYTES) warn(`only ${gb} GB of disk free; downloading a new 8B model needs about 6 GB`);
    else ok(`${gb} GB of disk free`);
  } catch {
    // statfs is unavailable on some platforms; skip.
  }

  const ramGb = os.totalmem() / 1024 ** 3;
  const recs = recommendations(ramGb);
  const pick = recs[0];
  const recTags = new Set(recs.map((r) => r.tag));
  console.log(`        recommended for ${Math.round(ramGb)} GB of memory: ${recs.map((r) => `${r.tag} (${r.gb} GB, ${r.note})`).join("; ")}`);

  const wanted = {
    HUMANLY_FAST_MODEL: process.env.HUMANLY_FAST_MODEL ?? "llama3.1:8b",
    HUMANLY_BEST_MODEL: process.env.HUMANLY_BEST_MODEL ?? "llama3.1:8b",
    HUMANLY_JUDGE_MODEL: process.env.HUMANLY_JUDGE_MODEL ?? "llama3.1:8b",
  };
  const judgeIsLocal = (process.env.HUMANLY_JUDGE_PROVIDER ?? "ollama") === "ollama";
  const localModels = [...new Set(judgeIsLocal ? Object.values(wanted) : [wanted.HUMANLY_FAST_MODEL, wanted.HUMANLY_BEST_MODEL])];
  const missing = localModels.filter((m) => !installed(names!, m));
  const switchTo = (tag: string, why: string) => {
    setEnv({
      HUMANLY_PROVIDER: "ollama",
      HUMANLY_FAST_MODEL: tag,
      HUMANLY_BEST_MODEL: tag,
      ...(judgeIsLocal ? { HUMANLY_JUDGE_MODEL: tag } : {}),
    });
    ok(`${why}; set the model${judgeIsLocal ? "s" : ""} to ${tag} in ${ENV_FILE}`);
  };
  const pullPick = (): boolean => {
    if (freeDiskBytes() < (pick.gb + 1.5) * 1024 ** 3) {
      bad(`Not enough disk space to download ${pick.tag} (${pick.gb} GB).`, "Free up some space, then run again.");
      return false;
    }
    console.log(`        downloading ${pick.tag} (about ${pick.gb} GB)...`);
    const pull = spawnSync("ollama", ["pull", pick.tag], { stdio: "inherit" });
    if (pull.status !== 0) {
      bad("The model download failed.", `See the message above; \`ollama pull ${pick.tag}\` resumes where it stopped.`);
      return false;
    }
    names!.push(pick.tag);
    return true;
  };

  const current = wanted.HUMANLY_FAST_MODEL;
  const weak = WEAK.test(current) || (ramGb <= 12 && /^llama3\.1:8b/.test(current));

  if (missing.length === 0) {
    ok(`configured model${localModels.length > 1 ? "s are" : " is"} installed: ${localModels.join(", ")}`);
    if (weak && values.pull && !recTags.has(current)) {
      if (pullPick()) switchTo(pick.tag, `upgraded from ${current}`);
    } else if (weak) {
      warn(
        `${current} ${WEAK.test(current) ? "is one of the weakest rewriters" : "is too big for this Mac and partly runs on the CPU"}. ` +
          `Run with --pull to download and switch to ${pick.tag} (${pick.gb} GB).`,
      );
    }
  } else {
    const installedRec = recs.find((r) => installed(names!, r.tag))?.tag;
    const alternative = installedRec ?? pickInstalled(names);
    if (values.pull && !installedRec) {
      if (pullPick()) switchTo(pick.tag, `${missing.join(", ")} not installed`);
    } else if (alternative && values.fix) {
      switchTo(alternative, `${missing.join(", ")} not installed`);
    } else {
      bad(
        `Model not installed: ${missing.join(", ")}.`,
        alternative
          ? `Run with --fix to use "${alternative}" (already installed), or --fix --pull to download ${pick.tag} (${pick.gb} GB).`
          : `Run with --fix --pull to download ${pick.tag} (${pick.gb} GB), or run \`ollama pull ${pick.tag}\`.`,
      );
    }
  }

  const fast = process.env.HUMANLY_FAST_MODEL ?? current;
  const judgeModel = process.env.HUMANLY_JUDGE_MODEL ?? fast;
  if (judgeIsLocal && judgeModel !== fast && ramGb <= 20) {
    warn(`the judge (${judgeModel}) differs from the writer (${fast}); on this Mac Ollama will swap them in and out of memory on every rewrite.`);
  }
  if (judgeIsLocal) {
    warn(
      "the judge is the same small local model, so scores are optimistic. For trustworthy evals, set HUMANLY_JUDGE_PROVIDER=groq with GROQ_API_KEY " +
        "(its judge model defaults to llama-3.3-70b-versatile) and delete any HUMANLY_JUDGE_MODEL line, or set it to a model that provider serves.",
    );
  } else if (process.env.HUMANLY_JUDGE_MODEL && installed(names!, process.env.HUMANLY_JUDGE_MODEL)) {
    warn(
      `HUMANLY_JUDGE_MODEL=${process.env.HUMANLY_JUDGE_MODEL} is a local Ollama model, but the judge runs on ${process.env.HUMANLY_JUDGE_PROVIDER}. ` +
        "Humanly uses that provider's default judge model instead; delete the line or set a model the provider serves.",
    );
  }
  const numCtx = Number(process.env.HUMANLY_NUM_CTX) || 4096;
  ok(
    `context window budget: ${numCtx} tokens (HUMANLY_NUM_CTX). Longer passages are rewritten in pieces. To raise it, start Ollama with OLLAMA_CONTEXT_LENGTH=8192 and set HUMANLY_NUM_CTX=8192.`,
  );
}

// After a rewrite the model is loaded, and recent Ollama versions report the
// context window it was loaded with. A mismatch with HUMANLY_NUM_CTX means the
// app either chunks text needlessly or risks having instructions cut off.
async function checkWindow() {
  const base = (process.env.HUMANLY_BASE_URL ?? "http://127.0.0.1:11434/v1").replace(/\/v1\/?$/, "").replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(4000) });
    const data = (await res.json()) as { models?: Array<{ name: string; context_length?: number }> };
    const loaded = data.models?.find((m) => typeof m.context_length === "number");
    if (!loaded?.context_length) return;
    const configured = Number(process.env.HUMANLY_NUM_CTX) || Number(process.env.OLLAMA_CONTEXT_LENGTH) || 4096;
    if (loaded.context_length === configured) {
      ok(`Ollama is running ${loaded.name} with a ${loaded.context_length}-token window, matching HUMANLY_NUM_CTX`);
    } else if (values.fix) {
      setEnv({ HUMANLY_NUM_CTX: String(loaded.context_length) });
      ok(`Ollama runs ${loaded.name} with a ${loaded.context_length}-token window; set HUMANLY_NUM_CTX=${loaded.context_length} in ${ENV_FILE}`);
    } else {
      warn(
        `Ollama runs ${loaded.name} with a ${loaded.context_length}-token window but the app assumes ${configured}. ` +
          `Set HUMANLY_NUM_CTX=${loaded.context_length} (or re-run with --fix).`,
      );
    }
  } catch {
    // Older Ollama versions don't report it; the default assumption stands.
  }
}

async function smokeTest() {
  console.log(`\nTest rewrite (${values.quality} quality)`);
  console.log(`  input: ${SAMPLE.slice(0, 110)}${SAMPLE.length > 110 ? "..." : ""}`);
  const [{ config }, { runPipeline }, { paraphraseRequestSchema }] = await Promise.all([
    import("@/lib/config"),
    import("@/lib/pipeline"),
    import("@/lib/prompt"),
  ]);
  const started = Date.now();
  const stage: string[] = [];
  try {
    const result = await runPipeline(
      paraphraseRequestSchema.parse({ text: SAMPLE, mode: "humanize", quality: values.quality }),
      { persist: false, emit: (e) => e.type === "stage" && stage.push(e.message) },
    );
    ok(`rewrite finished in ${((Date.now() - started) / 1000).toFixed(1)}s using ${config.providerLabel} (${config.fastModel})`);
    console.log(`\n  output: ${result.output}\n`);
    console.log(
      `  change: ${Math.round(result.metrics.lexicalChange * 100)}% new vocabulary, ${Math.round(result.metrics.sentencesReworked * 100)}% of sentences reworked (${result.detail})`,
    );
    if (result.scores) {
      const s = result.scores;
      console.log(`  scores: overall ${s.overall.toFixed(1)} | natural ${s.naturalness} | meaning ${s.meaning} | fluency ${s.fluency}`);
    } else {
      warn("the rewrite worked but scoring failed (small models often can't produce the judge's JSON); rewrites still work");
    }
  } catch (error) {
    const { describeApiError } = await import("@/lib/llm");
    bad(`rewrite failed: ${describeApiError(error).message}`);
    console.log(`        detail: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`Humanly doctor (Node ${process.version}, ${process.platform}/${process.arch})`);
const [major, minor] = process.versions.node.split(".").map(Number);
if (major > 22 || (major === 22 && minor >= 13)) ok("Node version is new enough");
else bad(`Node ${process.version} is too old.`, "Install Node 22.13 or newer.");

const provider = process.env.HUMANLY_PROVIDER ?? "anthropic";
if (fs.existsSync(ENV_FILE)) ok(`${ENV_FILE} found (provider: ${provider})`);
else if (values.fix) {
  setEnv({ HUMANLY_PROVIDER: "ollama" });
  process.env.HUMANLY_PROVIDER = "ollama";
  ok(`created ${ENV_FILE} with HUMANLY_PROVIDER=ollama`);
} else warn(`${ENV_FILE} not found; using provider "${provider}". Run with --fix to create one for Ollama.`);

if ((process.env.HUMANLY_PROVIDER ?? "anthropic") === "ollama") await checkOllama();
else ok(`provider "${process.env.HUMANLY_PROVIDER ?? "anthropic"}" is hosted; skipping Ollama checks`);

if (failures === 0) await smokeTest();
if (failures === 0 && (process.env.HUMANLY_PROVIDER ?? "anthropic") === "ollama") await checkWindow();
else console.log("\nFix the items above, then run `npm run doctor` again.");

console.log(failures === 0 ? "\nAll good. Start the app with: npm run dev" : `\n${failures} problem${failures === 1 ? "" : "s"} found.`);
process.exit(failures === 0 ? 0 : 1);
