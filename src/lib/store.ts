import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config";
import type { ModeId } from "./modes";

// Local SQLite store for rewrites, feedback and what the learner derives from
// them. Everything stays on this machine.

export interface Scores {
  naturalness: number;
  meaning: number;
  fluency: number;
  modeFit: number;
  overall: number;
}

export interface Run {
  id: string;
  createdAt: number;
  mode: ModeId;
  quality: string;
  options: Record<string, unknown>;
  input: string;
  output: string;
  finalOutput: string | null;
  scores: Scores | null;
  rating: number;
  note: string | null;
  guideVersion: number | null;
  usedInLearning: boolean;
}

export interface Guide {
  version: number;
  createdAt: number;
  rules: string[];
  status: "active" | "rejected" | "manual" | "retired";
  evalScore: number | null;
  baselineScore: number | null;
  summary: string;
}

export interface LearnedPhrase {
  phrase: string;
  suggestion: string;
  createdAt: number;
}

export interface EvalRun {
  id: number;
  createdAt: number;
  label: string;
  guideVersion: number | null;
  meanScore: number;
  results: unknown;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  mode TEXT NOT NULL,
  quality TEXT NOT NULL,
  options TEXT NOT NULL,
  input TEXT NOT NULL,
  output TEXT NOT NULL,
  final_output TEXT,
  scores TEXT,
  rating INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  guide_version INTEGER,
  used_in_learning INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS guides (
  version INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  rules TEXT NOT NULL,
  status TEXT NOT NULL,
  eval_score REAL,
  baseline_score REAL,
  summary TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS phrases (
  phrase TEXT PRIMARY KEY,
  suggestion TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  label TEXT NOT NULL,
  guide_version INTEGER,
  mean_score REAL NOT NULL,
  results TEXT NOT NULL
);
`;

const globalForDb = globalThis as unknown as { humanlyDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (!globalForDb.humanlyDb) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const database = new DatabaseSync(path.join(config.dataDir, "humanly.db"));
    database.exec("PRAGMA journal_mode = WAL;");
    database.exec(SCHEMA);
    globalForDb.humanlyDb = database;
  }
  return globalForDb.humanlyDb;
}

type Row = Record<string, unknown>;

function toRun(row: Row): Run {
  return {
    id: row.id as string,
    createdAt: row.created_at as number,
    mode: row.mode as ModeId,
    quality: row.quality as string,
    options: JSON.parse(row.options as string),
    input: row.input as string,
    output: row.output as string,
    finalOutput: (row.final_output as string | null) ?? null,
    scores: row.scores ? JSON.parse(row.scores as string) : null,
    rating: row.rating as number,
    note: (row.note as string | null) ?? null,
    guideVersion: (row.guide_version as number | null) ?? null,
    usedInLearning: row.used_in_learning === 1,
  };
}

function toGuide(row: Row): Guide {
  return {
    version: row.version as number,
    createdAt: row.created_at as number,
    rules: JSON.parse(row.rules as string),
    status: row.status as Guide["status"],
    evalScore: (row.eval_score as number | null) ?? null,
    baselineScore: (row.baseline_score as number | null) ?? null,
    summary: row.summary as string,
  };
}

export function saveRun(run: Omit<Run, "finalOutput" | "rating" | "note" | "usedInLearning">): void {
  db()
    .prepare(
      `INSERT INTO runs (id, created_at, mode, quality, options, input, output, scores, guide_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      run.id,
      run.createdAt,
      run.mode,
      run.quality,
      JSON.stringify(run.options),
      run.input,
      run.output,
      run.scores ? JSON.stringify(run.scores) : null,
      run.guideVersion,
    );
}

export function getRun(id: string): Run | null {
  const row = db().prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row | undefined;
  return row ? toRun(row) : null;
}

// Records feedback. Any change re-queues the run for the learner.
export function recordFeedback(
  id: string,
  feedback: { rating?: number; note?: string | null; finalOutput?: string | null },
): boolean {
  const run = getRun(id);
  if (!run) return false;
  const rating = feedback.rating ?? run.rating;
  const note = feedback.note !== undefined ? feedback.note : run.note;
  let finalOutput = feedback.finalOutput !== undefined ? feedback.finalOutput : run.finalOutput;
  if (finalOutput !== null && finalOutput.trim() === run.output.trim()) finalOutput = null;
  db()
    .prepare("UPDATE runs SET rating = ?, note = ?, final_output = ?, used_in_learning = 0 WHERE id = ?")
    .run(rating, note, finalOutput, id);
  return true;
}

// Runs carrying a signal: a rating, a note, or a hand-edited final version.
const HAS_FEEDBACK = "(rating != 0 OR note IS NOT NULL OR final_output IS NOT NULL)";

export function pendingFeedback(limit = 40): Run[] {
  return (
    db()
      .prepare(`SELECT * FROM runs WHERE used_in_learning = 0 AND ${HAS_FEEDBACK} ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Row[]
  ).map(toRun);
}

export function countPendingFeedback(): number {
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM runs WHERE used_in_learning = 0 AND ${HAS_FEEDBACK}`)
    .get() as Row;
  return row.n as number;
}

export function markUsedInLearning(ids: string[]): void {
  const stmt = db().prepare("UPDATE runs SET used_in_learning = 1 WHERE id = ?");
  for (const id of ids) stmt.run(id);
}

// Rewrites the user approved or corrected, as candidates for few-shot examples.
export function exampleRuns(mode: ModeId, limit = 200): Run[] {
  return (
    db()
      .prepare(
        `SELECT * FROM runs WHERE mode = ? AND rating >= 0 AND (rating = 1 OR final_output IS NOT NULL)
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(mode, limit) as Row[]
  ).map(toRun);
}

export function stats() {
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS runs,
              SUM(rating = 1) AS liked,
              SUM(rating = -1) AS disliked,
              SUM(final_output IS NOT NULL) AS edited,
              AVG(json_extract(scores, '$.overall')) AS avgScore
       FROM runs`,
    )
    .get() as Row;
  return {
    runs: (row.runs as number) ?? 0,
    liked: (row.liked as number) ?? 0,
    disliked: (row.disliked as number) ?? 0,
    edited: (row.edited as number) ?? 0,
    avgScore: (row.avgScore as number | null) ?? null,
    pending: countPendingFeedback(),
  };
}

export function activeGuide(): Guide | null {
  const row = db()
    .prepare("SELECT * FROM guides WHERE status IN ('active', 'manual') ORDER BY version DESC LIMIT 1")
    .get() as Row | undefined;
  return row ? toGuide(row) : null;
}

export function listGuides(limit = 30): Guide[] {
  return (db().prepare("SELECT * FROM guides ORDER BY version DESC LIMIT ?").all(limit) as Row[]).map(toGuide);
}

export function saveGuide(guide: Omit<Guide, "version" | "createdAt">): number {
  const database = db();
  if (guide.status === "active" || guide.status === "manual") {
    database.exec("UPDATE guides SET status = 'retired' WHERE status IN ('active', 'manual')");
  }
  const result = database
    .prepare(
      "INSERT INTO guides (created_at, rules, status, eval_score, baseline_score, summary) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      Date.now(),
      JSON.stringify(guide.rules),
      guide.status,
      guide.evalScore,
      guide.baselineScore,
      guide.summary,
    );
  return Number(result.lastInsertRowid);
}

export function learnedPhrases(): LearnedPhrase[] {
  return (db().prepare("SELECT * FROM phrases ORDER BY created_at DESC").all() as Row[]).map((row) => ({
    phrase: row.phrase as string,
    suggestion: row.suggestion as string,
    createdAt: row.created_at as number,
  }));
}

export function addPhrases(phrases: Array<{ phrase: string; suggestion: string }>): void {
  const stmt = db().prepare("INSERT OR IGNORE INTO phrases (phrase, suggestion, created_at) VALUES (?, ?, ?)");
  for (const p of phrases) {
    const phrase = p.phrase.trim().toLowerCase();
    if (phrase.length >= 3 && phrase.length <= 60) stmt.run(phrase, p.suggestion.trim(), Date.now());
  }
}

export function removePhrase(phrase: string): void {
  db().prepare("DELETE FROM phrases WHERE phrase = ?").run(phrase);
}

export function saveEvalRun(run: Omit<EvalRun, "id" | "createdAt">): void {
  db()
    .prepare("INSERT INTO eval_runs (created_at, label, guide_version, mean_score, results) VALUES (?, ?, ?, ?, ?)")
    .run(Date.now(), run.label, run.guideVersion, run.meanScore, JSON.stringify(run.results));
}

export function listEvalRuns(limit = 30): Omit<EvalRun, "results">[] {
  return (
    db()
      .prepare("SELECT id, created_at, label, guide_version, mean_score FROM eval_runs ORDER BY id DESC LIMIT ?")
      .all(limit) as Row[]
  ).map((row) => ({
    id: row.id as number,
    createdAt: row.created_at as number,
    label: row.label as string,
    guideVersion: (row.guide_version as number | null) ?? null,
    meanScore: row.mean_score as number,
  }));
}
