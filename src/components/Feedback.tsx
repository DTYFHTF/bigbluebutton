"use client";

import { useState } from "react";

// Thumbs up/down with an optional note. Ratings and notes feed the learner.
export function Feedback({ runId, output }: { runId: string; output: string }) {
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  async function send(body: { rating?: number; note?: string }) {
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, finalOutput: output, ...body }),
      });
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }

  function rate(value: 1 | -1) {
    const next = rating === value ? 0 : value;
    setRating(next);
    setNoteOpen(next !== 0);
    send({ rating: next });
  }

  return (
    <div className="feedback">
      <button
        className={`icon${rating === 1 ? " icon-on" : ""}`}
        aria-label="Good rewrite"
        aria-pressed={rating === 1}
        onClick={() => rate(1)}
      >
        👍
      </button>
      <button
        className={`icon${rating === -1 ? " icon-on-bad" : ""}`}
        aria-label="Bad rewrite"
        aria-pressed={rating === -1}
        onClick={() => rate(-1)}
      >
        👎
      </button>
      {noteOpen && (
        <form
          className="feedback-note"
          onSubmit={(e) => {
            e.preventDefault();
            send({ note });
            setNoteOpen(false);
          }}
        >
          <input
            autoFocus
            value={note}
            maxLength={2000}
            placeholder={rating === 1 ? "What worked? (optional)" : "What was off? (optional)"}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="link" type="submit">
            Save
          </button>
        </form>
      )}
      {saved && !noteOpen && <span className="muted">Thanks, noted</span>}
    </div>
  );
}
