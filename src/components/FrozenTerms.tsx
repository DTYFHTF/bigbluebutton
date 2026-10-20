"use client";

import { useState } from "react";

interface Props {
  terms: string[];
  onChange: (terms: string[]) => void;
}

// Words or phrases the rewrite must leave untouched (names, product terms,
// technical vocabulary). Enter or comma adds the typed term.
export function FrozenTerms({ terms, onChange }: Props) {
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const next = raw
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t && !terms.includes(t));
    if (next.length) onChange([...terms, ...next].slice(0, 50));
    setDraft("");
  }

  return (
    <div className="frozen">
      <label htmlFor="frozen-input">Freeze words</label>
      <div className="chips">
        {terms.map((t) => (
          <span key={t} className="chip">
            {t}
            <button aria-label={`Unfreeze ${t}`} onClick={() => onChange(terms.filter((x) => x !== t))}>
              ×
            </button>
          </span>
        ))}
        <input
          id="frozen-input"
          value={draft}
          placeholder={terms.length ? "" : "Names, terms to keep…"}
          onChange={(e) => {
            const value = e.target.value;
            if (value.endsWith(",")) add(value);
            else setDraft(value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && terms.length) {
              onChange(terms.slice(0, -1));
            }
          }}
          onBlur={() => draft && add(draft)}
        />
      </div>
    </div>
  );
}
