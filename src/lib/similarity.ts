// TF-IDF cosine similarity, used to pick the past rewrites most similar to
// the current input as few-shot examples.

const STOPWORDS = new Set(
  "a an and are as at be but by for from has have i in is it its of on or that the this to was were will with you your we our they their".split(
    " ",
  ),
);

export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function rankBySimilarity<T>(query: string, docs: T[], getText: (doc: T) => string): Array<{ doc: T; score: number }> {
  const docTerms = docs.map((d) => terms(getText(d)));
  const queryTerms = terms(query);
  const df = new Map<string, number>();
  for (const ts of [...docTerms, queryTerms]) {
    for (const t of new Set(ts)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = docTerms.length + 1;
  const vector = (ts: string[]) => {
    const tf = new Map<string, number>();
    for (const t of ts) tf.set(t, (tf.get(t) ?? 0) + 1);
    const v = new Map<string, number>();
    for (const [t, count] of tf) v.set(t, count * Math.log(1 + n / (df.get(t) ?? 1)));
    return v;
  };
  const norm = (v: Map<string, number>) => Math.sqrt([...v.values()].reduce((a, b) => a + b * b, 0)) || 1;
  const q = vector(queryTerms);
  const qn = norm(q);
  return docs
    .map((doc, i) => {
      const d = vector(docTerms[i]);
      let dot = 0;
      for (const [t, w] of q) dot += w * (d.get(t) ?? 0);
      return { doc, score: dot / (qn * norm(d)) };
    })
    .sort((a, b) => b.score - a.score);
}
