import type { ModeId } from "./modes";

export interface HistoryItem {
  id: string;
  // Server-side run, so feedback on a restored rewrite still reaches the learner.
  runId?: string | null;
  at: number;
  mode: ModeId;
  input: string;
  output: string;
}

const KEY = "humanly:history";
const MAX_ITEMS = 20;

// History lives in the visitor's browser only; storage can be unavailable
// (private windows, blocked site data), so every access is guarded.
export function loadHistory(): HistoryItem[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const items = raw ? (JSON.parse(raw) as HistoryItem[]) : [];
    return Array.isArray(items) ? items.slice(0, MAX_ITEMS) : [];
  } catch {
    return [];
  }
}

export function saveHistory(items: HistoryItem[]): HistoryItem[] {
  const trimmed = items.slice(0, MAX_ITEMS);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore: history is a convenience.
  }
  return trimmed;
}
