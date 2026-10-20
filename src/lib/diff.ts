// Word-level diff between the original and the rewrite, used to colour
// changed words in the output pane (like QuillBot's "show changes").

export interface DiffToken {
  text: string;
  changed: boolean;
}

// Tokens are words plus the whitespace/punctuation that follows them, so the
// tokens concatenate back to the exact output text.
export function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+\s*/g) ?? [];
}

function normalize(token: string): string {
  return token.trim().toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

// Marks each output token as changed unless it is part of the longest common
// subsequence with the input (compared case- and punctuation-insensitively).
export function diffWords(input: string, output: string): DiffToken[] {
  const a = tokenize(input).map(normalize);
  const bTokens = tokenize(output);
  const b = bTokens.map(normalize);
  const n = a.length;
  const m = b.length;

  // LCS table, rolling rows would save memory but inputs are capped at a
  // few thousand words so a full table is fine.
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const kept = new Array<boolean>(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      kept[j] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  return bTokens.map((text, k) => ({
    text,
    // Whitespace-only and punctuation-only tokens never count as changes.
    changed: !kept[k] && b[k] !== "",
  }));
}

export function changedRatio(tokens: DiffToken[]): number {
  const words = tokens.filter((t) => normalize(t.text) !== "");
  if (words.length === 0) return 0;
  return words.filter((t) => t.changed).length / words.length;
}
