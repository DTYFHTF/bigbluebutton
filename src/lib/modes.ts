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
  // One or two plain sentences for the compact prompt used with small models,
  // which follow short positive instructions better than long rule lists.
  compact: string;
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
- Your own sentences. Rebuild each sentence in your words rather than lightly editing the original's wording and sentence frames.

What to remove:
- Stock phrasing: delve, tapestry, testament, realm, landscape, journey, unlock, harness, leverage, foster, seamless, robust, pivotal, crucial, navigate the complexities, plays a key role, in today's fast-paced world, it's important to note, it's worth noting, ever-evolving.
- Formulaic structure: "not only X but also Y", reflexive lists of three, "Whether you're A or B", rhetorical questions answered straight away, and closing lines that restate the paragraph ("In conclusion", "Overall", "Ultimately").
- Em dashes as default punctuation. Use commas, periods, colons or parentheses; at most one em dash per paragraph.
- Empty intensifiers and marketing adjectives (truly, incredibly, game-changing, cutting-edge).

Keep the author's point of view, register and intent. A formal original stays formal, just less mechanical.`,
    compact:
      "Write it the way a thoughtful person would by hand: specific words, a natural rhythm that mixes short and long sentences, everyday linking words like but, so and also, and contractions where they fit. Build each sentence in your own words instead of lightly editing the original's sentences.",
  },
  {
    id: "standard",
    label: "Standard",
    blurb: "Balanced rewording",
    instruction:
      "Reword the text in a balanced way: change wording and sentence structure while keeping the meaning, tone and length close to the original.",
    compact:
      "Reword it in your own words and sentence structures, keeping the tone and length close to the original.",
  },
  {
    id: "fluency",
    label: "Fluency",
    blurb: "Fix grammar, keep wording",
    instruction:
      "Make the text read smoothly and correctly. Fix grammar, awkward phrasing and word choice, but change as little as possible beyond that.",
    compact:
      "Fix grammar, awkward phrasing and word choice. Keep the original wording wherever it already works.",
  },
  {
    id: "formal",
    label: "Formal",
    blurb: "Professional & polished",
    instruction:
      "Rewrite the text in a formal, professional register suitable for business or official communication. Avoid slang and contractions. Stay clear and direct rather than pompous.",
    compact:
      "Write it in a clear, professional register for business or official use: complete sentences, no slang, no contractions, direct rather than pompous.",
  },
  {
    id: "academic",
    label: "Academic",
    blurb: "Scholarly & precise",
    instruction:
      "Rewrite the text in a clear academic register: precise terminology, hedged claims where the original hedges, and logical connectives. Do not add citations, data or claims that are not in the original.",
    compact:
      "Write it in a precise academic register. Hedge only where the original hedges, and add no citations, data or new claims.",
  },
  {
    id: "simple",
    label: "Simple",
    blurb: "Easy to read",
    instruction:
      "Rewrite the text so it is easy to read for a general audience (around a 7th–8th grade reading level). Use short sentences and common words, and explain jargon in plain terms.",
    compact:
      "Write it so a 12-year-old could follow it: short sentences, everyday words, and any jargon explained.",
  },
  {
    id: "creative",
    label: "Creative",
    blurb: "Fresh & expressive",
    instruction:
      "Rewrite the text with fresh, vivid and original phrasing. You may restructure freely and use imagery, but keep every factual claim and the overall meaning intact.",
    compact:
      "Write it with fresh, vivid phrasing and a new structure, keeping every fact.",
  },
  {
    id: "shorten",
    label: "Shorten",
    blurb: "Same point, fewer words",
    instruction:
      "Rewrite the text to be noticeably more concise (aim for roughly 30–50% fewer words) while keeping every key point.",
    compact:
      "Write it in roughly half the words, keeping every key point.",
  },
  {
    id: "expand",
    label: "Expand",
    blurb: "Add depth & detail",
    instruction:
      "Rewrite the text with more depth: elaborate on the existing points, add connective explanation and examples that follow directly from the original. Do not invent facts, statistics, names or sources.",
    compact:
      "Write it at greater length, explaining each point more fully. Add no new facts, names, numbers or sources.",
  },
  {
    id: "custom",
    label: "Custom",
    blurb: "Describe your own tone",
    instruction: "Rewrite the text in the style the user describes below.",
    compact: "Write it in the style the user describes below.",
  },
];

export const MODE_IDS = MODES.map((m) => m.id) as [ModeId, ...ModeId[]];

export function getMode(id: ModeId): Mode {
  const mode = MODES.find((m) => m.id === id);
  if (!mode) throw new Error(`Unknown mode: ${id}`);
  return mode;
}

// Synonym slider: 1 = keep most original words, 5 = replace aggressively.
// The percentages give the model a concrete target; they're starting points
// to calibrate with `npm run eval -- --compare`, not measured optima.
export const SYNONYM_TARGETS: Record<number, number> = { 1: 0.1, 2: 0.2, 3: 0.35, 4: 0.5, 5: 0.65 };

export const SYNONYM_LEVELS: Record<number, string> = {
  1: "Change about 10% of the words: keep most of the original vocabulary and only swap words that are weak or repetitive.",
  2: "Change about 20% of the words, swapping in natural alternatives while keeping most of the original vocabulary.",
  3: "Change about 35% of the words and phrases, using natural alternatives and some new sentence structures.",
  4: "Change about half of the words and phrases, and restructure sentences where it reads better.",
  5: "Change two thirds or more of the words and phrases, and restructure freely, while keeping the meaning exact.",
};

// Below this share of new words, a rewrite is close to a copy of the input.
// One retry is made in that case (except in Fluency, which should change little).
export const NEAR_COPY_FLOOR: Record<number, number> = { 1: 0.03, 2: 0.07, 3: 0.12, 4: 0.18, 5: 0.25 };

export const DIALECTS = {
  "en-US": "American English",
  "en-GB": "British English",
  "en-AU": "Australian English",
  "en-CA": "Canadian English",
} as const;

export type Dialect = keyof typeof DIALECTS;
