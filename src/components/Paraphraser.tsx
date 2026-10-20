"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { findAiPhrases } from "@/lib/aiisms";
import { loadHistory, saveHistory, type HistoryItem } from "@/lib/history";
import { DIALECTS, MODES, getMode, type Dialect, type ModeId } from "@/lib/modes";
import { countWords } from "@/lib/text";
import { Feedback } from "./Feedback";
import { FrozenTerms } from "./FrozenTerms";
import { InputPane } from "./InputPane";
import { OutputPane, type RewriteOptions } from "./OutputPane";
import { Signals } from "./Signals";

type Status = "idle" | "streaming" | "done" | "error";
type Quality = "best" | "fast";

export interface Scores {
  naturalness: number;
  meaning: number;
  fluency: number;
  modeFit: number;
  overall: number;
}

interface Phrase {
  phrase: string;
  suggestion: string;
}

const SAMPLE = `In today's fast-paced digital landscape, effective communication plays a crucial role in the success of any organization. It's important to note that teams who leverage collaborative tools are able to navigate the complexities of remote work more seamlessly. Moreover, fostering a culture of transparency not only boosts morale but also unlocks the full potential of every team member. In conclusion, embracing these strategies is a testament to a company's commitment to growth.`;

const SYNONYM_LABELS = ["", "Minimal", "Light", "Balanced", "Strong", "Maximum"];
const QUALITY_KEY = "humanly:quality";

function readQuality(): Quality {
  try {
    return window.localStorage.getItem(QUALITY_KEY) === "fast" ? "fast" : "best";
  } catch {
    return "best";
  }
}

export function Paraphraser({ maxWords }: { maxWords: number }) {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  // What the pipeline returned, so hand edits can be told apart from it.
  const [generated, setGenerated] = useState("");
  const [source, setSource] = useState("");
  const [runKey, setRunKey] = useState(0);
  const [runId, setRunId] = useState<string | null>(null);
  const [scores, setScores] = useState<Scores | null>(null);
  const [detail, setDetail] = useState("");
  const [stage, setStage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ModeId>("humanize");
  const [quality, setQuality] = useState<Quality>("best");
  const [synonyms, setSynonyms] = useState(3);
  const [dialect, setDialect] = useState<Dialect>("en-US");
  const [frozen, setFrozen] = useState<string[]>([]);
  const [customTone, setCustomTone] = useState("");
  const [highlight, setHighlight] = useState(true);
  const [showChanges, setShowChanges] = useState(true);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setHistory(loadHistory());
    setQuality(readQuality());
    fetch("/api/phrases")
      .then((r) => (r.ok ? r.json() : { phrases: [] }))
      .then((d) => setPhrases(d.phrases ?? []))
      .catch(() => {});
  }, []);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Hand edits and swapped-in alternatives are the strongest learning
  // signal; save the latest version shortly after the user stops changing it.
  useEffect(() => {
    if (status !== "done" || !runId || !generated || output === generated) return;
    const timer = setTimeout(() => {
      fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, finalOutput: output }),
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [output, generated, runId, status]);

  const words = countWords(input);
  const overLimit = maxWords > 0 && words > maxWords;
  const streaming = status === "streaming";
  const roboticCount = highlight ? findAiPhrases(input, phrases).length : 0;
  const options: RewriteOptions = {
    mode,
    quality,
    synonyms,
    dialect,
    frozen,
    customTone: mode === "custom" ? customTone : undefined,
  };
  const canRun = input.trim().length > 0 && !overLimit && !streaming && (mode !== "custom" || customTone.trim());

  function chooseQuality(q: Quality) {
    setQuality(q);
    try {
      window.localStorage.setItem(QUALITY_KEY, q);
    } catch {
      // Ignore: the choice just won't be remembered.
    }
  }

  async function paraphrase() {
    if (!canRun) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const text = input;
    setStatus("streaming");
    setError(null);
    setOutput("");
    setGenerated("");
    setSource(text);
    setRunId(null);
    setScores(null);
    setDetail("");
    setStage("Starting…");
    setEditing(false);
    setRunKey((n) => n + 1);

    let result = "";
    try {
      const res = await fetch("/api/paraphrase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, ...options }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Request failed (${res.status}).`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let final: { runId: string | null; output: string; scores: Scores | null; detail: string } | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.type === "stage") {
            setStage(event.message);
          } else if (event.type === "delta") {
            result += event.text;
            setOutput(result);
          } else if (event.type === "reset") {
            result = "";
            setOutput("");
          } else if (event.type === "result") {
            final = event;
          } else if (event.type === "error") {
            throw new Error(event.message ?? "Something went wrong.");
          }
        }
      }
      if (!final) throw new Error("The connection dropped before the rewrite finished. Try again.");

      setOutput(final.output);
      setGenerated(final.output);
      setRunId(final.runId);
      setScores(final.scores);
      setDetail(final.detail);
      setStatus("done");
      setHistory((items) =>
        saveHistory([
          { id: crypto.randomUUID(), runId: final.runId, at: Date.now(), mode, input: text, output: final.output },
          ...items,
        ]),
      );
    } catch (e) {
      if (controller.signal.aborted) {
        // Stopped by the user: keep whatever arrived.
        setOutput(result.trim());
        setStatus(result.trim() ? "done" : "idle");
        return;
      }
      // A partial rewrite from a failed request is not trustworthy; drop it.
      setOutput("");
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStatus("error");
    } finally {
      setStage("");
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy to the clipboard.");
    }
  }

  function replaceRange(start: number, end: number, text: string) {
    setOutput((current) => current.slice(0, start) + text + current.slice(end));
  }

  function restore(item: HistoryItem) {
    abortRef.current?.abort();
    setInput(item.input);
    setSource(item.input);
    setOutput(item.output);
    setGenerated(item.output);
    setRunId(item.runId ?? null);
    setScores(null);
    setDetail("");
    setMode(item.mode);
    setStatus("done");
    setError(null);
    setEditing(false);
    setRunKey((n) => n + 1);
    setHistoryOpen(false);
  }

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
          <Link className="ghost" href="/learning">
            Learning
          </Link>
          <button className="ghost" onClick={() => setHistoryOpen((v) => !v)} aria-expanded={historyOpen}>
            History{history.length ? ` (${history.length})` : ""}
          </button>
        </nav>
      </header>

      <main className="workspace">
        <div className="modes" role="tablist" aria-label="Rewrite mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              className={`mode${mode === m.id ? " mode-active" : ""}`}
              onClick={() => setMode(m.id)}
              title={m.blurb}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="controls">
          <div className="control">
            <span className="control-label">Quality</span>
            <div className="segmented" role="radiogroup" aria-label="Quality">
              {(["best", "fast"] as const).map((q) => (
                <button
                  key={q}
                  role="radio"
                  aria-checked={quality === q}
                  className={quality === q ? "segmented-active" : ""}
                  onClick={() => chooseQuality(q)}
                  title={q === "best" ? "Several drafts, judged, then polished" : "One quick pass"}
                >
                  {q === "best" ? "Best" : "Fast"}
                </button>
              ))}
            </div>
          </div>
          {mode !== "fluency" && (
            <div className="control">
              <label htmlFor="synonyms">
                Synonyms <span className="muted">· {SYNONYM_LABELS[synonyms]}</span>
              </label>
              <input
                id="synonyms"
                type="range"
                min={1}
                max={5}
                step={1}
                value={synonyms}
                onChange={(e) => setSynonyms(Number(e.target.value))}
              />
            </div>
          )}
          <div className="control">
            <label htmlFor="dialect">English</label>
            <select id="dialect" value={dialect} onChange={(e) => setDialect(e.target.value as Dialect)}>
              {Object.entries(DIALECTS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <FrozenTerms terms={frozen} onChange={setFrozen} />
        </div>

        {mode === "custom" && (
          <div className="custom-tone">
            <label htmlFor="custom-tone">Describe the style you want</label>
            <input
              id="custom-tone"
              value={customTone}
              maxLength={300}
              placeholder="e.g. friendly and upbeat, like a note to a coworker"
              onChange={(e) => setCustomTone(e.target.value)}
            />
          </div>
        )}

        <div className="panes">
          <section className="pane" aria-label="Original text">
            <InputPane
              value={input}
              onChange={setInput}
              onSubmit={paraphrase}
              highlight={highlight}
              extraPhrases={phrases}
            />
            <div className="pane-foot">
              <span className={overLimit ? "error-text" : "muted"}>
                {words}
                {maxWords > 0 ? ` / ${maxWords}` : ""} words
              </span>
              {highlight && roboticCount > 0 && (
                <span className="robotic-count">{roboticCount} robotic phrases</span>
              )}
              <div className="spacer" />
              {!input && (
                <button className="ghost" onClick={() => setInput(SAMPLE)}>
                  Try a sample
                </button>
              )}
              {input && (
                <button className="ghost" onClick={() => setInput("")}>
                  Clear
                </button>
              )}
              {streaming ? (
                <button className="primary" onClick={stop}>
                  Stop
                </button>
              ) : (
                <button className="primary" onClick={paraphrase} disabled={!canRun} title="Ctrl/⌘ + Enter">
                  {mode === "humanize" ? "Humanize" : "Paraphrase"}
                </button>
              )}
            </div>
          </section>

          <section className="pane" aria-label="Rewritten text">
            {streaming && stage && (
              <div className="stage" role="status">
                <span className="spinner" aria-hidden="true" />
                {stage}
              </div>
            )}
            <OutputPane
              key={runKey}
              source={source}
              output={output}
              streaming={streaming}
              editing={editing}
              showChanges={showChanges}
              options={options}
              onReplace={replaceRange}
              onEdit={setOutput}
            />
            {error && <p className="error-banner">{error}</p>}
            {status === "done" && scores && (
              <div className="scores">
                <span className="score-main" title="Overall quality score from the judge model">
                  {scores.overall.toFixed(1)}
                </span>
                <span>Natural {scores.naturalness}</span>
                <span>Meaning {scores.meaning}</span>
                <span>Fluency {scores.fluency}</span>
                {detail && <span className="muted">· {detail}</span>}
              </div>
            )}
            <div className="pane-foot">
              <span className="muted">{countWords(output)} words</span>
              {status === "done" && runId && <Feedback key={runId} runId={runId} output={output} />}
              <div className="spacer" />
              {output && !streaming && (
                <>
                  <button className="ghost" onClick={() => setEditing((v) => !v)}>
                    {editing ? "Done editing" : "Edit"}
                  </button>
                  <button className="ghost" onClick={() => setInput(output)} title="Use the rewrite as new input">
                    Rewrite again
                  </button>
                </>
              )}
              <button className="ghost" onClick={copy} disabled={!output || streaming}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </section>
        </div>

        <div className="toggles">
          <label>
            <input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} /> Highlight
            robotic phrases
          </label>
          <label>
            <input type="checkbox" checked={showChanges} onChange={(e) => setShowChanges(e.target.checked)} /> Show
            changed words
          </label>
          {output && !streaming && !editing && (
            <span className="muted">Tip: click any sentence in the rewrite for alternatives.</span>
          )}
        </div>

        {status === "done" && output && (
          <Signals source={source} output={output} frozen={frozen} extraPhrases={phrases} />
        )}
      </main>

      {historyOpen && (
        <aside className="history" aria-label="History">
          <div className="history-head">
            <h2>History</h2>
            <div>
              {history.length > 0 && (
                <button className="link" onClick={() => setHistory(saveHistory([]))}>
                  Clear
                </button>
              )}
              <button className="link" onClick={() => setHistoryOpen(false)}>
                Close
              </button>
            </div>
          </div>
          {history.length === 0 && <p className="muted">Rewrites you make are listed here.</p>}
          {history.map((item) => (
            <button key={item.id} className="history-item" onClick={() => restore(item)}>
              <span className="history-meta">
                {getMode(item.mode).label} · {new Date(item.at).toLocaleString()}
              </span>
              <span className="history-text">{item.output.slice(0, 140)}</span>
            </button>
          ))}
        </aside>
      )}

      <footer className="footer">
        Humanly rewrites text to read more naturally. Review every rewrite, keep your own facts straight, and follow
        your school&apos;s or employer&apos;s rules on AI-assisted writing.
      </footer>
    </div>
  );
}
