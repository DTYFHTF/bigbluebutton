"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Guide {
  version: number;
  createdAt: number;
  rules: string[];
  status: string;
  evalScore: number | null;
  baselineScore: number | null;
  summary: string;
}

interface LearningData {
  stats: { runs: number; liked: number; disliked: number; edited: number; avgScore: number | null; pending: number };
  guide: Guide | null;
  guides: Guide[];
  phrases: Array<{ phrase: string; suggestion: string; createdAt: number }>;
  evalRuns: Array<{ id: number; createdAt: number; label: string; guideVersion: number | null; meanScore: number }>;
  status: {
    running: boolean;
    last: null | { status?: string; summary?: string; error?: string; candidate?: number; baseline?: number; finishedAt: number };
  };
  models: { provider: string; fast: string; best: string; judge: string; candidates: number };
  autoLearnEvery: number;
}

async function post(body: object) {
  const res = await fetch("/api/learning", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Request failed.");
}

export default function LearningPage() {
  const [data, setData] = useState<LearningData | null>(null);
  const [rulesDraft, setRulesDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/learning", { cache: "no-store" });
      const next = (await res.json()) as LearningData;
      setData(next);
      setDirty((d) => {
        if (!d) setRulesDraft((next.guide?.rules ?? []).join("\n"));
        return d;
      });
    } catch {
      setError("Couldn't load learning data.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while a learning round runs in the background.
  useEffect(() => {
    if (!data?.status.running) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [data?.status.running, load]);

  async function act(body: object) {
    setError(null);
    try {
      await post(body);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  }

  async function saveRules() {
    const rules = rulesDraft
      .split("\n")
      .map((r) => r.replace(/^\s*[-•*]\s*/, "").trim())
      .filter(Boolean);
    setDirty(false);
    await act({ action: "saveGuide", rules });
  }

  const last = data?.status.last;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            h
          </span>
          Humanly
        </div>
        <nav className="topnav">
          <Link className="ghost" href="/">
            Back to editor
          </Link>
        </nav>
      </header>

      <main className="workspace learning">
        <h1>Learning</h1>
        <p className="muted">
          Every rewrite is saved with its scores. Your ratings, notes, hand edits and chosen alternatives become
          examples for future rewrites and feed a style guide that the learner keeps updating. A new guide is only
          adopted if it scores at least as well as the current one on the eval passages.
        </p>
        {error && <p className="error-text">{error}</p>}

        {!data ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <section className="card">
              <div className="stat-grid">
                <Stat label="Rewrites" value={data.stats.runs} />
                <Stat label="Liked" value={data.stats.liked} />
                <Stat label="Disliked" value={data.stats.disliked} />
                <Stat label="Hand-edited" value={data.stats.edited} />
                <Stat label="Avg. score" value={data.stats.avgScore === null ? "–" : data.stats.avgScore.toFixed(2)} />
                <Stat label="New feedback" value={data.stats.pending} />
              </div>
              <p className="muted" style={{ marginBottom: 0 }}>
                {data.models.provider} · fast <code>{data.models.fast}</code> · best <code>{data.models.best}</code> ×
                {data.models.candidates} drafts · judge <code>{data.models.judge}</code>.{" "}
                {data.autoLearnEvery > 0
                  ? `Learns automatically after every ${data.autoLearnEvery} pieces of new feedback.`
                  : "Automatic learning is off."}
              </p>
            </section>

            <section className="card">
              <div className="row">
                <h2 style={{ margin: 0 }}>Learner</h2>
                <div className="spacer" />
                <button className="primary" disabled={data.status.running} onClick={() => act({ action: "learn", force: true })}>
                  {data.status.running ? "Learning…" : "Learn now"}
                </button>
              </div>
              {data.status.running && (
                <p className="muted">Drafting a new guide and testing it against the current one. This takes a minute or two.</p>
              )}
              {!data.status.running && last && (
                <p className={last.error ? "error-text" : "muted"}>
                  Last round ({new Date(last.finishedAt).toLocaleString()}):{" "}
                  {last.error
                    ? last.error
                    : last.status === "nothing-to-learn"
                      ? "no new feedback."
                      : `${last.status}, ${last.candidate?.toFixed(2)} vs ${last.baseline?.toFixed(2)}. ${last.summary ?? ""}`}
                </p>
              )}
            </section>

            <section className="card">
              <div className="row">
                <h2 style={{ margin: 0 }}>Style guide</h2>
                {data.guide && (
                  <span className={`badge badge-${data.guide.status}`}>
                    v{data.guide.version} · {data.guide.status}
                  </span>
                )}
              </div>
              <p className="muted">One rule per line. These are added to every rewrite prompt. Saving creates a new version.</p>
              <textarea
                className="rules-editor"
                value={rulesDraft}
                placeholder="No rules yet. Rate and edit some rewrites, then run the learner, or write your own rules here."
                onChange={(e) => {
                  setRulesDraft(e.target.value);
                  setDirty(true);
                }}
              />
              <div className="row">
                <button className="primary" disabled={!dirty} onClick={saveRules}>
                  Save guide
                </button>
                {dirty && (
                  <button
                    className="ghost"
                    onClick={() => {
                      setRulesDraft((data.guide?.rules ?? []).join("\n"));
                      setDirty(false);
                    }}
                  >
                    Discard changes
                  </button>
                )}
              </div>
            </section>

            <section className="card">
              <h2>Learned robotic phrases</h2>
              <p className="muted">Flagged in the editor and counted against drafts, on top of the built-in list.</p>
              <div className="chips" style={{ marginBottom: 10 }}>
                {data.phrases.length === 0 && <span className="muted">None yet.</span>}
                {data.phrases.map((p) => (
                  <span key={p.phrase} className="chip" title={`Try: ${p.suggestion}`}>
                    {p.phrase}
                    <button aria-label={`Remove ${p.phrase}`} onClick={() => act({ action: "removePhrase", phrase: p.phrase })}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <form
                className="row phrase-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (phrase.trim().length < 3) return;
                  act({ action: "addPhrase", phrase, suggestion });
                  setPhrase("");
                  setSuggestion("");
                }}
              >
                <input value={phrase} placeholder="Phrase to flag" onChange={(e) => setPhrase(e.target.value)} />
                <input value={suggestion} placeholder="Suggested alternative" onChange={(e) => setSuggestion(e.target.value)} />
                <button className="ghost" type="submit">
                  Add
                </button>
              </form>
            </section>

            <section className="card">
              <h2>Guide history</h2>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Version</th>
                      <th>Date</th>
                      <th>Status</th>
                      <th>Score (new vs old)</th>
                      <th>Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.guides.length === 0 && (
                      <tr>
                        <td colSpan={5} className="muted">
                          No guides yet.
                        </td>
                      </tr>
                    )}
                    {data.guides.map((g) => (
                      <tr key={g.version}>
                        <td>v{g.version}</td>
                        <td>{new Date(g.createdAt).toLocaleDateString()}</td>
                        <td>
                          <span className={`badge badge-${g.status}`}>{g.status}</span>
                        </td>
                        <td>
                          {g.evalScore === null ? "–" : `${g.evalScore.toFixed(2)} vs ${g.baselineScore?.toFixed(2)}`}
                        </td>
                        <td>{g.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="card">
              <h2>Eval runs</h2>
              <p className="muted">
                Run <code>npm run eval</code> to score the whole pipeline on the eval passages; learning rounds are logged
                here too.
              </p>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Label</th>
                      <th>Guide</th>
                      <th>Mean score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.evalRuns.length === 0 && (
                      <tr>
                        <td colSpan={4} className="muted">
                          No eval runs yet.
                        </td>
                      </tr>
                    )}
                    {data.evalRuns.map((r) => (
                      <tr key={r.id}>
                        <td>{new Date(r.createdAt).toLocaleString()}</td>
                        <td>{r.label}</td>
                        <td>{r.guideVersion ? `v${r.guideVersion}` : "–"}</td>
                        <td>{r.meanScore.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
