import type { Scores } from "./store";

export interface Heuristics {
  robotic: number;
  missingFrozen: number;
}

const clamp = (n: number, lo = 0, hi = 10) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : 0));

// Combines the judge's 1-10 ratings with local checks into one 0-10 score.
// Meaning is a gate: a fluent rewrite that changes the facts loses.
export function overallScore(
  ratings: { naturalness: number; meaning: number; fluency: number; modeFit: number },
  heuristics: Heuristics,
): number {
  const n = clamp(ratings.naturalness);
  const m = clamp(ratings.meaning);
  const f = clamp(ratings.fluency);
  const mf = clamp(ratings.modeFit);
  let score = 0.45 * n + 0.35 * m + 0.1 * f + 0.1 * mf;
  if (m < 7) score -= (7 - m) * 1.5;
  score -= Math.min(2, heuristics.robotic * 0.3);
  score -= heuristics.missingFrozen * 2;
  return Math.round(clamp(score) * 100) / 100;
}

export function toScores(
  ratings: { naturalness: number; meaning: number; fluency: number; modeFit: number },
  heuristics: Heuristics,
): Scores {
  return {
    naturalness: clamp(ratings.naturalness),
    meaning: clamp(ratings.meaning),
    fluency: clamp(ratings.fluency),
    modeFit: clamp(ratings.modeFit),
    overall: overallScore(ratings, heuristics),
  };
}
