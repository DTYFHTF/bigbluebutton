"use client";

import { useMemo } from "react";
import { countEmDashes, findAiPhrases } from "@/lib/aiisms";
import { changedRatio, diffWords } from "@/lib/diff";
import { lexicalChange, sentencesReworked } from "@/lib/metrics";
import { missingFrozenTerms } from "@/lib/prompt";
import { countWords, sentenceRhythm } from "@/lib/text";

interface Props {
  source: string;
  output: string;
  frozen: string[];
  extraPhrases?: Array<{ phrase: string; suggestion: string }>;
}

// Before/after writing signals. These are style heuristics to guide the
// writer, not a score from (or a promise about) any AI-detection product.
export function Signals({ source, output, frozen, extraPhrases = [] }: Props) {
  const stats = useMemo(() => {
    const before = sentenceRhythm(source);
    const after = sentenceRhythm(output);
    return {
      words: [countWords(source), countWords(output)],
      robotic: [findAiPhrases(source, extraPhrases).length, findAiPhrases(output, extraPhrases).length],
      variety: [before.stdev, after.stdev],
      avgLength: [before.mean, after.mean],
      dashes: [countEmDashes(source), countEmDashes(output)],
      changed: changedRatio(diffWords(source, output)),
      vocabulary: lexicalChange(source, output),
      reworked: sentencesReworked(source, output),
      missing: missingFrozenTerms(source, output, frozen),
    };
  }, [source, output, frozen, extraPhrases]);

  const rows: Array<[string, string, string, string]> = [
    ["Words", String(stats.words[0]), String(stats.words[1]), ""],
    [
      "New vocabulary",
      "",
      `${Math.round(stats.vocabulary * 100)}%`,
      "Share of the rewrite's words that weren't in the original. Word order doesn't count.",
    ],
    [
      "Sentences reworked",
      "",
      `${Math.round(stats.reworked * 100)}%`,
      "Sentences that aren't close copies of an original sentence.",
    ],
    [
      "Robotic phrases",
      String(stats.robotic[0]),
      String(stats.robotic[1]),
      "Stock phrases like “delve” or “it’s important to note”. Lower is better.",
    ],
    [
      "Sentence variety",
      stats.variety[0].toFixed(1),
      stats.variety[1].toFixed(1),
      "Spread of sentence lengths, in words. Human writing usually mixes short and long sentences.",
    ],
    ["Avg. sentence length", stats.avgLength[0].toFixed(1), stats.avgLength[1].toFixed(1), ""],
    ["Em dashes", String(stats.dashes[0]), String(stats.dashes[1]), "Heavy em-dash use is a common tell."],
  ];

  return (
    <section className="signals" aria-label="Writing signals">
      <div className="signals-head">
        <h2>Writing signals</h2>
        <span className="pill">{Math.round(stats.changed * 100)}% of words changed</span>
      </div>
      <table>
        <thead>
          <tr>
            <th scope="col">Signal</th>
            <th scope="col">Original</th>
            <th scope="col">Rewrite</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b, hint]) => (
            <tr key={label}>
              <th scope="row" title={hint || undefined}>
                {label}
                {hint && <span className="hint"> ⓘ</span>}
              </th>
              <td>{a}</td>
              <td>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {stats.missing.length > 0 && (
        <p className="error-text">Frozen terms missing from the rewrite: {stats.missing.join(", ")}</p>
      )}
    </section>
  );
}
