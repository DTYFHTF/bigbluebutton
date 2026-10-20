# Humanly: paraphraser & writing humanizer

Humanly rewrites stiff, generic, AI-sounding text into clear, natural writing. It follows a QuillBot-style workflow: paste text, pick a mode, get a rewrite with the changes highlighted, then click any sentence for alternatives.

The rewrite engine keeps getting better as you use it. It learns from your ratings, notes and hand edits, and it only adopts a change if that change holds up on a fixed eval set.

Built with Next.js (App Router, TypeScript), the Claude API and Node's built-in SQLite.

## Features

- **10 modes**: Humanize, Standard, Fluency, Formal, Academic, Simple, Creative, Shorten, Expand, and Custom (describe your own tone).
- **Best / Fast quality.** Best writes several drafts, has a judge model score them, polishes the winner using the judge's notes, and ships the polish only if it beats the draft. Fast is one pass.
- **Quality scores** on every rewrite: overall, naturalness, meaning, fluency.
- **Synonym slider**, **freeze words**, **US/UK/AU/CA English**, live streaming with a Stop button.
- **Show changes**, **rephrase a sentence** (click it for three alternatives), and **edit the output** in place.
- **Robotic phrase highlighter** and a before/after **writing signals** panel.
- **Feedback**: thumbs up/down with an optional note. Hand edits and swapped-in alternatives are saved automatically.
- **Learning dashboard** (`/learning`): stats, the learned style guide (editable), learned phrases, guide history with A/B scores, and eval runs.

## Getting started

Requires Node.js 22.13+ (it uses the built-in `node:sqlite`).

```bash
npm install
cp .env.example .env.local   # add your ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

Everything you write and all feedback is stored locally in `data/humanly.db`.

### Choosing a provider (free options included)

Set `HUMANLY_PROVIDER` in `.env.local`:

| Provider | Cost | Key |
| --- | --- | --- |
| `anthropic` (default) | Paid, best quality | `ANTHROPIC_API_KEY` from console.anthropic.com |
| `nvidia` | Free tier, rate-limited | `NVIDIA_API_KEY` from build.nvidia.com |
| `openrouter` | Free `:free` models, rate-limited | `OPENROUTER_API_KEY` from openrouter.ai/keys |
| `groq` | Free tier, rate-limited | `GROQ_API_KEY` from console.groq.com |
| `custom` | any OpenAI-compatible API | `HUMANLY_BASE_URL` + `HUMANLY_API_KEY` |

```bash
# example: NVIDIA free tier
HUMANLY_PROVIDER=nvidia
NVIDIA_API_KEY=nvapi-...
```

Free providers use a default Llama 70B model (override with `HUMANLY_*_MODEL` if it is retired). They get 2 drafts instead of 3, and calls are spaced out to stay under per-minute caps, so a Best rewrite takes longer. The engine asks free models for JSON and validates it, retrying once if the reply is malformed. Run `npm run eval` on each provider and compare the mean scores before settling on one. The scores come from the configured judge model, so only compare runs that use the same judge model.

### Configuration

All models default to the provider's preset (`claude-haiku-5-5` on Anthropic). You can change any setting in `.env.local`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HUMANLY_FAST_MODEL` / `HUMANLY_FAST_EFFORT` | provider preset / `low` | Fast, single-pass rewrites (effort: Anthropic only) |
| `HUMANLY_BEST_MODEL` / `HUMANLY_BEST_EFFORT` | provider preset / `medium` | Drafts, polish, alternatives, learner |
| `HUMANLY_JUDGE_MODEL` / `HUMANLY_JUDGE_EFFORT` | provider preset / `medium` | Scores drafts and final output |
| `HUMANLY_CANDIDATES` | `3` (`2` on free providers) | Competing drafts per Best rewrite (1–5) |
| `HUMANLY_MAX_WORDS` | `0` (off) | Word cap per request |
| `HUMANLY_RATE_LIMIT_PER_MIN` | `0` (off) | Requests per IP per minute |
| `HUMANLY_DATA_DIR` | `./data` | Where the SQLite database lives |
| `HUMANLY_AUTO_LEARN_EVERY` | `10` | Run the learner after this many new pieces of feedback (0 = manual only) |
| `HUMANLY_LEARN_TOLERANCE` | `0.15` | How much a new guide may score below the current one and still be adopted |

To push quality further, set `HUMANLY_BEST_MODEL=claude-opus-5-5`. Use a judge model that differs from the drafting model, so the judge isn't grading its own writing.

## How the engine works

```
Best quality
  drafts ×N (in parallel, each with a different "angle")
     │   prompt = mode + learned style guide + your most similar approved rewrites (few-shot)
     ▼
  judge: scores every draft (naturalness, meaning, fluency, mode fit) + concrete issues
     │   + local checks (robotic phrases, missing frozen terms)
     ▼
  polish the best draft using the judge's issues  ──streamed to you──▶
     ▼
  final check: polish vs draft; ship whichever scores higher
```

### How it keeps improving

1. **Few-shot memory.** Rewrites you liked or corrected become examples. Each new request pulls in the three most similar ones from the same mode (TF-IDF retrieval). When you corrected a rewrite, your edited version is the example.
2. **Learned style guide.** The learner reads your recent feedback and revises a short list of style rules that goes into every prompt. Hand edits are the strongest evidence, then notes, then ratings. It also adds phrases you keep removing to the robotic-phrase list.
3. **Guarded adoption.** Before adopting a new guide, the learner rewrites a rotating slice of the eval passages with both the old and new guides and has the judge score each pair side by side. If the new guide makes quality worse, it is rejected.
4. **Eval tracking.** `npm run eval` scores the whole pipeline on the 12 passages in `eval/passages.json` and logs the mean, so you can see whether changes to models, prompts or guides actually help.

The learner runs automatically once enough new feedback builds up. You can also start it with **Learn now** on `/learning`, or with `npm run learn`.

```bash
npm test                                   # unit tests
npm run typecheck
npm run eval                               # Best quality, all eval passages
npm run eval -- --quality fast --limit 4   # quicker check
npm run learn -- --force                   # learning round from the CLI
```

## Code map

```
src/
  app/
    page.tsx, learning/page.tsx    editor and learning dashboard
    api/paraphrase                  runs the pipeline, streams NDJSON events
    api/alternatives                three rewrites of one sentence
    api/feedback                    ratings, notes, hand edits; triggers auto-learning
    api/learning, api/phrases       dashboard data and actions
  lib/
    llm.ts          one interface over Anthropic and OpenAI-compatible providers
    openaiCompat.ts streaming, retries, think-tag stripping, JSON extraction
    pipeline.ts     drafts → judge → polish → final check
    judge.ts        comparative scoring with structured output
    scoring.ts      combines judge ratings and local checks into one score
    learn.ts        style-guide learner with A/B adoption
    examples.ts     few-shot retrieval from approved and corrected rewrites
    store.ts        SQLite: runs, feedback, guides, phrases, eval runs
    prompt.ts       request schema and prompt builders
    modes.ts, aiisms.ts, diff.ts, segments.ts, text.ts, similarity.ts, evalset.ts
scripts/eval.mts, scripts/learn.mts
eval/passages.json
```

## Responsible use

Humanly is a writing tool. It improves clarity and voice, and it is not designed or tuned to defeat AI-detection systems. Its scores measure writing quality, not detectability. Users are responsible for following their school's or employer's rules on AI-assisted writing.
