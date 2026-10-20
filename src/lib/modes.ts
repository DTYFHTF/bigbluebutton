// Rewrite modes shown as tabs in the UI. Each mode's `instruction` is the
// part of the system prompt that changes between modes.

export type ModeId =
  | "humanize"
  | "standard"
  | "fluency"
  | "formal"
  | "academic"
  | "simple"
  | "creative"
  | "shorten"
  | "expand"
  | "custom";

export interface Mode {
  id: ModeId;
  label: string;
  blurb: string;
  instruction: string;
}

export const MODES: Mode[] = [
  {
    id: "humanize",
    label: "Humanize",
    blurb: "Sounds like a person wrote it",
    instruction: `Rewrite the text so it reads like a skilled person wrote it: someone who knows the subject and writes plainly.

What that sounds like:
- Specific over general. Prefer concrete nouns and verbs to abstractions ("cut costs by a third" rather than "drive significant cost efficiencies"), but never invent specifics the original doesn't contain.
- Rhythm that varies. Some sentences are short. Others run longer and carry a clause or two. Don't let three sentences in a row share the same length or shape.
- Plain connective tissue: "but", "so", "and", "also", or no transition at all, rather than "Moreover", "Furthermore", "Additionally".
- Direct claims. Drop stacked hedges ("may potentially", "it could be argued that") unless the uncertainty is the point.
- Contractions wherever the register allows them.
- Varied sentence openings. Avoid "This [noun]..." openers that point back at the previous sentence.
- Don't over-polish. A good writer leaves some sentences plain.

What to remove:
- Stock phrasing: delve, tapestry, testament, realm, landscape, journey, unlock, harness, leverage, foster, seamless, robust, pivotal, crucial, navigate the complexities, plays a key role, in today's fast-paced world, it's important to note, it's worth noting, ever-evolving.
- Formulaic structure: "not only X but also Y", reflexive lists of three, "Whether you're A or B", rhetorical questions answered straight away, and closing lines that restate the paragraph ("In conclusion", "Overall", "Ultimately").
- Em dashes as default punctuation. Use commas, periods, colons or parentheses; at most one em dash per paragraph.
- Empty intensifiers and marketing adjectives (truly, incredibly, game-changing, cutting-edge).

Keep the author's point of view, register and intent. A formal original stays formal, just less mechanical.`,
  },
  {
    id: "standard",
    label: "Standard",
    blurb: "Balanced rewording",
    instruction:
      "Reword the text in a balanced way: change wording and sentence structure while keeping the meaning, tone and length close to the original.",
  },
  {
    id: "fluency",
    label: "Fluency",
    blurb: "Fix grammar, keep wording",
    instruction:
      "Make the text read smoothly and correctly. Fix grammar, awkward phrasing and word choice, but change as little as possible beyond that.",
  },
  {
    id: "formal",
    label: "Formal",
    blurb: "Professional & polished",
    instruction:
      "Rewrite the text in a formal, professional register suitable for business or official communication. Avoid slang and contractions. Stay clear and direct rather than pompous.",
  },
  {
    id: "academic",
    label: "Academic",
    blurb: "Scholarly & precise",
    instruction:
      "Rewrite the text in a clear academic register: precise terminology, hedged claims where the original hedges, and logical connectives. Do not add citations, data or claims that are not in the original.",
  },
  {
    id: "simple",
    label: "Simple",
    blurb: "Easy to read",
    instruction:
      "Rewrite the text so it is easy to read for a general audience (around a 7th–8th grade reading level). Use short sentences and common words, and explain jargon in plain terms.",
  },
  {
    id: "creative",
    label: "Creative",
    blurb: "Fresh & expressive",
    instruction:
      "Rewrite the text with fresh, vivid and original phrasing. You may restructure freely and use imagery, but keep every factual claim and the overall meaning intact.",
  },
  {
    id: "shorten",
    label: "Shorten",
    blurb: "Same point, fewer words",
    instruction:
      "Rewrite the text to be noticeably more concise (aim for roughly 30–50% fewer words) while keeping every key point.",
  },
  {
    id: "expand",
    label: "Expand",
    blurb: "Add depth & detail",
    instruction:
      "Rewrite the text with more depth: elaborate on the existing points, add connective explanation and examples that follow directly from the original. Do not invent facts, statistics, names or sources.",
  },
  {
    id: "custom",
    label: "Custom",
    blurb: "Describe your own tone",
    instruction: "Rewrite the text in the style the user describes below.",
  },
];

export const MODE_IDS = MODES.map((m) => m.id) as [ModeId, ...ModeId[]];

export function getMode(id: ModeId): Mode {
  const mode = MODES.find((m) => m.id === id);
  if (!mode) throw new Error(`Unknown mode: ${id}`);
  return mode;
}

// Synonym slider: 1 = keep most original words, 5 = replace aggressively.
export const SYNONYM_LEVELS: Record<number, string> = {
  1: "Keep most of the original vocabulary; only swap words that are clearly weak or repetitive.",
  2: "Replace some words with natural synonyms, keeping most of the original vocabulary.",
  3: "Replace a moderate share of words and phrases with natural alternatives.",
  4: "Replace most words and phrases with natural alternatives where meaning allows.",
  5: "Change as much of the vocabulary and phrasing as possible while keeping the meaning exact.",
};

export const DIALECTS = {
  "en-US": "American English",
  "en-GB": "British English",
  "en-AU": "Australian English",
  "en-CA": "Canadian English",
} as const;

export type Dialect = keyof typeof DIALECTS;
