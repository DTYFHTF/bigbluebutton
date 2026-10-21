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
const PREFERRED = ["llama3.1", "llama3.2", "llama3", "qwen2.5", "qwen3", "gemma", "mistral", "phi3", "phi4"];

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

  const wanted = {
    HUMANLY_FAST_MODEL: process.env.HUMANLY_FAST_MODEL ?? "llama3.1:8b",
    HUMANLY_BEST_MODEL: process.env.HUMANLY_BEST_MODEL ?? "llama3.1:8b",
    HUMANLY_JUDGE_MODEL: process.env.HUMANLY_JUDGE_MODEL ?? "llama3.1:8b",
  };
  const missing = [...new Set(Object.values(wanted))].filter((m) => !installed(names!, m));
  if (missing.length === 0) {
    ok(`configured model${new Set(Object.values(wanted)).size > 1 ? "s are" : " is"} installed: ${[...new Set(Object.values(wanted))].join(", ")}`);
    return;
  }

  const alternative = pickInstalled(names);
  if (alternative && values.fix) {
    setEnv({
      HUMANLY_PROVIDER: "ollama",
      HUMANLY_FAST_MODEL: alternative,
      HUMANLY_BEST_MODEL: alternative,
      HUMANLY_JUDGE_MODEL: alternative,
    });
    ok(`${missing.join(", ")} not installed; set all three models to ${alternative} in ${ENV_FILE}`);
    return;
  }
  if (!alternative && values.pull) {
    const free = (() => {
      try {
        const s = fs.statfsSync(os.homedir());
        return s.bavail * s.bsize;
      } catch {
        return Infinity;
      }
    })();
    if (free < MIN_PULL_BYTES) {
      bad("Not enough disk space to download a model.", "Free up about 6 GB, then run again.");
      return;
    }
    console.log("        downloading llama3.1:8b (about 4.9 GB)...");
    const pull = spawnSync("ollama", ["pull", "llama3.1:8b"], { stdio: "inherit" });
    if (pull.status === 0) ok("downloaded llama3.1:8b");
    else bad("The model download failed.", "See the message above; `ollama pull llama3.1:8b` can be re-run and resumes.");
    return;
  }
  bad(
    `Model not installed: ${missing.join(", ")}.`,
    alternative
      ? `Run with --fix to use "${alternative}" (already installed), or run \`ollama pull ${missing[0]}\`.`
      : `Run \`ollama pull ${missing[0]}\` (about 4.9 GB), or re-run with --fix --pull.`,
  );
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
else console.log("\nFix the items above, then run `npm run doctor` again.");

console.log(failures === 0 ? "\nAll good. Start the app with: npm run dev" : `\n${failures} problem${failures === 1 ? "" : "s"} found.`);
process.exit(failures === 0 ? 0 : 1);
