// Phrases that make prose read as generic or machine-written. Used to
// highlight them in the editor and to compare input against output.

export interface PhraseHit {
  phrase: string;
  start: number;
  end: number;
  suggestion: string;
}

const PHRASES: Array<[RegExp, string]> = [
  [/\bdelve(?:s|d)?(?: into)?\b/gi, "look at, dig into"],
  [/\b(?:rich |intricate |vibrant )?tapestry\b/gi, "mix, range"],
  [/\bin today'?s (?:fast-paced|digital|modern|ever-changing) (?:world|age|landscape)\b/gi, "cut it, or name the actual change"],
  [/\bit(?:'s| is) (?:important|worth|crucial) (?:to note|noting|to remember|to mention)(?: that)?\b/gi, "just say the thing"],
  [/\bplays? an? (?:crucial|pivotal|vital|key|significant) role\b/gi, "matters for, drives"],
  [/\bnavigat(?:e|es|ing) the (?:complex(?:ities)?|landscape|intricacies)(?: of)?\b/gi, "handle, deal with"],
  [/\b(?:ever-evolving|ever-changing) landscape\b/gi, "field, market"],
  [/\bunlock(?:s|ing)? (?:the )?(?:full )?potential\b/gi, "make the most of"],
  [/\bseamless(?:ly)?\b/gi, "smooth, easy"],
  [/\b(?:a )?testament to\b/gi, "shows, proves"],
  [/\bembark(?:s|ed|ing)? on (?:a |the )?journey\b/gi, "start"],
  [/\bfoster(?:s|ing|ed)?\b/gi, "build, encourage"],
  [/\bleverag(?:e|es|ing|ed)\b/gi, "use"],
  [/\butiliz(?:e|es|ing|ed)\b/gi, "use"],
  [/\bmoreover\b/gi, "also, and"],
  [/\bfurthermore\b/gi, "also, and"],
  [/\bin conclusion\b/gi, "cut it"],
  [/\bin summary\b/gi, "cut it"],
  [/\boverall,/gi, "cut it"],
  [/\bfirst and foremost\b/gi, "first"],
  [/\bat the end of the day\b/gi, "ultimately, or cut"],
  [/\b(?:a )?game[- ]changer\b/gi, "big shift"],
  [/\bcutting[- ]edge\b/gi, "new, latest"],
  [/\brobust\b/gi, "strong, reliable"],
  [/\bholistic\b/gi, "complete, whole"],
  [/\bparadigm shift\b/gi, "big change"],
  [/\bmyriad (?:of )?\b/gi, "many"],
  [/\bplethora of\b/gi, "many, plenty of"],
  [/\bstands? as a\b/gi, "is"],
  [/\bnot only\b[^.]{1,80}\bbut also\b/gi, "simplify the contrast"],
  [/\bwhether you'?re a\b[^.]{1,60}\bor a\b/gi, "speak to one reader"],
  [/\b(?:let'?s|let us) dive in\b/gi, "cut it"],
  [/\bin the realm of\b/gi, "in"],
  [/\bharness(?:es|ing)? the power of\b/gi, "use"],
  [/\bembrac(?:e|es|ing) the\b/gi, "accept, adopt"],
  [/\bcrucial(?:ly)?\b/gi, "key, important"],
  [/\bmeticulous(?:ly)?\b/gi, "careful"],
  [/\bunderscor(?:e|es|ed|ing)\b/gi, "shows, highlights"],
];

export function findAiPhrases(text: string): PhraseHit[] {
  const hits: PhraseHit[] = [];
  for (const [pattern, suggestion] of PHRASES) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      hits.push({ phrase: m[0], start: m.index, end: m.index + m[0].length, suggestion });
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);

  // Drop hits nested inside an earlier, longer hit.
  const result: PhraseHit[] = [];
  let lastEnd = -1;
  for (const hit of hits) {
    if (hit.start >= lastEnd) {
      result.push(hit);
      lastEnd = hit.end;
    }
  }
  return result;
}

export function countEmDashes(text: string): number {
  return (text.match(/—/g) ?? []).length;
}
