"use client";

import { useMemo, useState } from "react";
import { buildSegments } from "@/lib/segments";

export interface RewriteOptions {
  mode: string;
  quality: string;
  synonyms: number;
  dialect: string;
  frozen: string[];
  customTone?: string;
}

interface Props {
  source: string;
  output: string;
  streaming: boolean;
  editing: boolean;
  showChanges: boolean;
  options: RewriteOptions;
  onReplace: (start: number, end: number, text: string) => void;
  onEdit: (text: string) => void;
}

export function OutputPane({ source, output, streaming, editing, showChanges, options, onReplace, onEdit }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const [alternatives, setAlternatives] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [altError, setAltError] = useState<string | null>(null);

  const segments = useMemo(
    () => (streaming || !output ? [] : buildSegments(source, output)),
    [source, output, streaming],
  );

  const activeSegment = active !== null ? segments[active] : undefined;
  const activeText = activeSegment ? output.slice(activeSegment.start, activeSegment.end).trim() : "";

  async function openSentence(index: number) {
    const segment = segments[index];
    const sentence = output.slice(segment.start, segment.end).trim();
    if (!sentence) return;
    setActive(index);
    setAlternatives(null);
    setAltError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/alternatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...options, sentence, context: output }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't load alternatives.");
      setAlternatives(data.alternatives);
    } catch (e) {
      setAltError(e instanceof Error ? e.message : "Couldn't load alternatives.");
    } finally {
      setLoading(false);
    }
  }

  function choose(alt: string) {
    if (!activeSegment) return;
    const raw = output.slice(activeSegment.start, activeSegment.end);
    const lead = raw.match(/^\s*/)?.[0] ?? "";
    const trail = raw.match(/\s*$/)?.[0] ?? "";
    onReplace(activeSegment.start, activeSegment.end, lead + alt + trail);
    close();
  }

  function close() {
    setActive(null);
    setAlternatives(null);
    setAltError(null);
  }

  if (!output && !streaming) {
    return <div className="output output-empty">Your rewritten text will appear here.</div>;
  }

  if (editing) {
    return (
      <textarea
        className="output output-edit"
        value={output}
        aria-label="Edit the rewrite"
        autoFocus
        onChange={(e) => onEdit(e.target.value)}
      />
    );
  }

  return (
    <>
      <div className="output" aria-live="polite">
        {streaming ? (
          <>
            {output}
            <span className="cursor" aria-hidden="true" />
          </>
        ) : (
          segments.map((segment, i) => (
            <span
              key={i}
              role="button"
              tabIndex={0}
              className={`sentence${active === i ? " sentence-active" : ""}`}
              title="Click for other ways to say this"
              onClick={() => openSentence(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openSentence(i);
                }
              }}
            >
              {segment.tokens.map((t, j) => {
                if (!showChanges || !t.changed) return t.text;
                // Highlight the word only, not the whitespace after it.
                const word = t.text.trimEnd();
                return (
                  <span key={j}>
                    <span className="changed">{word}</span>
                    {t.text.slice(word.length)}
                  </span>
                );
              })}
            </span>
          ))
        )}
      </div>
      {active !== null && (
        <div className="alternatives">
          <div className="alternatives-head">
            <span>Rephrase sentence</span>
            <button className="link" onClick={close}>
              Close
            </button>
          </div>
          <p className="alternatives-current">{activeText}</p>
          {loading && <p className="muted">Finding alternatives…</p>}
          {altError && <p className="error-text">{altError}</p>}
          {alternatives?.map((alt, i) => (
            <button key={i} className="alternative" onClick={() => choose(alt)}>
              {alt}
            </button>
          ))}
          {alternatives?.length === 0 && <p className="muted">No alternatives found.</p>}
        </div>
      )}
    </>
  );
}
