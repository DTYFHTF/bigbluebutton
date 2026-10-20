# Humanly — paraphraser & AI humanizer

Humanly rewrites stiff, generic, AI-sounding text into clear, natural writing. It is modelled on the workflow of tools like QuillBot: paste text, pick a mode, get a rewrite with the changes highlighted, then click any sentence for alternatives.

Built with Next.js (App Router, TypeScript) and the Claude API.

## Features

- **10 modes**: Humanize, Standard, Fluency, Formal, Academic, Simple, Creative, Shorten, Expand, and Custom (describe your own tone).
- **Synonym slider** (1–5): how much of the original vocabulary to replace.
- **Freeze words**: names and terms that must come through unchanged; the app warns if one goes missing.
- **English dialects**: US, UK, Australian, Canadian spelling and usage.
- **Streaming output** with a Stop button.
- **Show changes**: word-level diff highlights what was rewritten, plus a "% changed" figure.
- **Rephrase a sentence**: click any sentence in the output to get three alternatives and swap one in.
- **Robotic phrase highlighter**: marks stock phrases ("delve into", "it's important to note", "plays a crucial role", …) in the input as you type.
- **Writing signals**: before/after comparison of robotic phrases, sentence-length variety, average sentence length and em-dash use.
- **History**: the last 20 rewrites, stored in the browser only.
- Per-IP rate limiting, an input word cap, and prompt-injection-safe prompting (the user's text is treated as content, never as instructions).

## Getting started

Requires Node.js 22+.

```bash
npm install
cp .env.example .env.local   # then add your ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Required. Key from console.anthropic.com |
| `HUMANLY_MODEL` | `claude-opus-5-5` | Model used for rewrites |
| `HUMANLY_MAX_WORDS` | `1500` | Max words per request |
| `HUMANLY_RATE_LIMIT_PER_MIN` | `20` | Requests per IP per minute |

```bash
npm test          # unit tests (diff, sentence splitting, phrase detection, prompts, rate limit)
npm run typecheck
npm run build
```

## How it works

```
src/
  app/
    page.tsx                  UI entry (server component, passes the word cap)
    api/paraphrase/route.ts   streams the rewrite as NDJSON (delta / done / error)
    api/alternatives/route.ts structured output: three rewrites of one sentence
  components/                 Paraphraser, InputPane (highlight overlay), OutputPane, Signals, FrozenTerms
  lib/
    modes.ts                  mode definitions and synonym levels
    prompt.ts                 request schema + system prompt builder
    aiisms.ts                 robotic phrase detector
    diff.ts                   word-level LCS diff
    segments.ts               groups the diff into clickable sentences
    text.ts                   word count, sentence splitting, rhythm stats
    rateLimit.ts              in-memory per-IP limiter
```

Requests use `effort: "low"` for fast, cheap rewrites, and opt into the API's server-side fallback (`fallbacks: "default"`) so a declined request is retried on Anthropic's recommended fallback model instead of failing.

## Taking it to production

Things this MVP intentionally leaves out, roughly in the order a business would need them:

1. **Accounts and billing** — auth (e.g. Clerk/Auth.js) and Stripe subscriptions; a free tier with a lower word cap (QuillBot uses 125 words) and a premium tier with all modes and a higher cap.
2. **Shared rate limiting / quotas** — the limiter is in-memory per instance; move it to Redis/Upstash and track usage per user.
3. **Cost controls** — log `usage` per request, set per-plan model and effort (a cheaper model for free users, for example).
4. **More tools around the core** — grammar checker, summarizer, tone detector, citation generator, browser extension, and a Word/Google Docs add-on.
5. **File upload** — .docx / .pdf in, .docx out.
6. **Evaluation set** — a fixed set of passages and a rubric to check that prompt changes improve output quality before shipping them.

## Responsible use

Humanly is a writing tool: it improves clarity and voice. It is not designed to defeat AI-detection systems, and the writing signals it shows are style heuristics, not a detector score. Users are responsible for following their school's or employer's rules on AI-assisted writing.
