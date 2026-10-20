"use client";

import { useMemo, useRef } from "react";
import { findAiPhrases } from "@/lib/aiisms";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  highlight: boolean;
  extraPhrases?: Array<{ phrase: string; suggestion: string }>;
  disabled?: boolean;
}

// A textarea with a backdrop layer behind it that marks robotic phrases.
// The backdrop renders the same text with the same metrics, so the marks
// line up with the characters in the textarea above it.
export function InputPane({ value, onChange, onSubmit, highlight, extraPhrases = [], disabled }: Props) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const hits = useMemo(
    () => (highlight ? findAiPhrases(value, extraPhrases) : []),
    [value, highlight, extraPhrases],
  );

  const marked = useMemo(() => {
    const nodes: React.ReactNode[] = [];
    let pos = 0;
    hits.forEach((hit, i) => {
      if (hit.start > pos) nodes.push(value.slice(pos, hit.start));
      nodes.push(
        <mark key={i} className="robotic">
          {value.slice(hit.start, hit.end)}
        </mark>,
      );
      pos = hit.end;
    });
    nodes.push(value.slice(pos));
    // A trailing newline in a textarea adds a line; keep the backdrop in step.
    nodes.push("\n ");
    return nodes;
  }, [value, hits]);

  return (
    <div className="editor">
      <div className="editor-backdrop" ref={backdropRef} aria-hidden="true">
        {marked}
      </div>
      <textarea
        className="editor-input"
        value={value}
        placeholder="Paste or type the text you want to rewrite…"
        spellCheck
        disabled={disabled}
        aria-label="Text to paraphrase"
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (backdropRef.current) backdropRef.current.scrollTop = e.currentTarget.scrollTop;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
    </div>
  );
}
