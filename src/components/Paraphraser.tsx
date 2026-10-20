"use client";

import { useEffect, useRef, useState } from "react";
import { findAiPhrases } from "@/lib/aiisms";
import { loadHistory, saveHistory, type HistoryItem } from "@/lib/history";
import { DIALECTS, MODES, getMode, type Dialect, type ModeId } from "@/lib/modes";
import { countWords } from "@/lib/text";
import { FrozenTerms } from "./FrozenTerms";
import { InputPane } from "./InputPane";
import { OutputPane, type RewriteOptions } from "./OutputPane";
import { Signals } from "./Signals";

type Status = "idle" | "streaming" | "done" | "error";

const SAMPLE = `In today's fast-paced digital landscape, effective communication plays a crucial role in the success of any organization. It's important to note that teams who leverage collaborative tools are able to navigate the complexities of remote work more seamlessly. Moreover, fostering a culture of transparency not only boosts morale but also unlocks the full potential of every team member. In conclusion, embracing these strategies is a testament to a company's commitment to growth.`;

const SYNONYM_LABELS = ["", "Minimal", "Light", "Balanced", "Strong", "Maximum"];

export function Paraphraser({ maxWords }: { maxWords: number }) {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [source, setSource] = useState("");
  const [runId, setRunId] = useState(0);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ModeId>("humanize");
  const [synonyms, setSynonyms] = useState(3);
  const [dialect, setDialect] = useState<Dialect>("en-US");
  const [frozen, setFrozen] = useState<string[]>([]);
  const [customTone, setCustomTone] = useState("");
  const [highlight, setHighlight] = useState(true);
  const [showChanges, setShowChanges] = useState(true);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => setHistory(loadHistory()), []);
  useEffect(() => () => abortRef.current?.abort(), []);

  const words = countWords(input);
  const overLimit = words > maxWords;
  const streaming = status === "streaming";
  const roboticCount = highlight ? findAiPhrases(input).length : 0;
  const options: RewriteOptions = {
    mode,
    synonyms,
    dialect,
    frozen,
    customTone: mode === "custom" ? customTone : undefined,
  };
  const canRun = input.trim().length > 0 && !overLimit && !streaming && (mode !== "custom" || customTone.trim());

  async function paraphrase() {
    if (!canRun) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const text = input;
    setStatus("streaming");
    setError(null);
    setOutput("");
    setSource(text);
    setRunId((n) => n + 1);

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
      let finished = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const event = JSON.parse(line) as { type: string; text?: string; message?: string };
          if (event.type === "delta") {
            result += event.text ?? "";
            setOutput(result);
          } else if (event.type === "error") {
            throw new Error(event.message ?? "Something went wrong.");
          } else if (event.type === "done") {
            finished = true;
          }
        }
      }
      if (!finished) throw new Error("The connection dropped before the rewrite finished. Try again.");

      result = result.trim();
      setOutput(result);
      setStatus("done");
      setHistory((items) =>
        saveHistory([{ id: crypto.randomUUID(), at: Date.now(), mode, input: text, output: result }, ...items]),
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
    setMode(item.mode);
    setStatus("done");
    setError(null);
    setRunId((n) => n + 1);
    setHistoryOpen(false);
  }

  function clearHistory() {
    setHistory(saveHistory([]));
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
        <button className="ghost" onClick={() => setHistoryOpen((v) => !v)} aria-expanded={historyOpen}>
          History{history.length ? ` (${history.length})` : ""}
        </button>
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
            <InputPane value={input} onChange={setInput} onSubmit={paraphrase} highlight={highlight} />
            <div className="pane-foot">
              <span className={overLimit ? "error-text" : "muted"}>
                {words} / {maxWords} words
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
            <OutputPane
              key={runId}
              source={source}
              output={output}
              streaming={streaming}
              showChanges={showChanges}
              options={options}
              onReplace={replaceRange}
            />
            {error && <p className="error-banner">{error}</p>}
            <div className="pane-foot">
              <span className="muted">{countWords(output)} words</span>
              <div className="spacer" />
              {output && !streaming && (
                <button className="ghost" onClick={() => setInput(output)} title="Use the rewrite as new input">
                  Rewrite again
                </button>
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
          {output && !streaming && <span className="muted">Tip: click any sentence in the rewrite for alternatives.</span>}
        </div>

        {status === "done" && output && <Signals source={source} output={output} frozen={frozen} />}
      </main>

      {historyOpen && (
        <aside className="history" aria-label="History">
          <div className="history-head">
            <h2>History</h2>
            <div>
              {history.length > 0 && (
                <button className="link" onClick={clearHistory}>
                  Clear
                </button>
              )}
              <button className="link" onClick={() => setHistoryOpen(false)}>
                Close
              </button>
            </div>
          </div>
          {history.length === 0 && <p className="muted">Rewrites you make are saved here, in this browser only.</p>}
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
