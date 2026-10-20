import { z } from "zod";
import { config } from "@/lib/config";
import { describeApiError, generateJson } from "@/lib/llm";
import { buildSystemPrompt, paraphraseRequestSchema } from "@/lib/prompt";
import { checkRateLimit, clientKey } from "@/lib/rateLimit";
import { activeGuide } from "@/lib/store";

export const runtime = "nodejs";

// Returns a few alternative rewrites of one sentence from the output, so the
// user can click a sentence and pick a different phrasing.
const requestSchema = paraphraseRequestSchema.omit({ text: true }).extend({
  sentence: z.string().trim().min(1).max(1500),
  context: z.string().max(200_000).default(""),
});

const resultSchema = z.object({
  alternatives: z.array(z.string()).describe("Three distinct rewrites of the sentence"),
});

export async function POST(request: Request) {
  const limit = checkRateLimit(clientKey(request.headers), config.rateLimitPerMin);
  if (!limit.ok) {
    return Response.json({ error: `Too many requests. Try again in ${limit.retryAfter}s.` }, { status: 429 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const { sentence, context, ...options } = parsed.data;

  const system =
    buildSystemPrompt(options, { guideRules: activeGuide()?.rules }) +
    `\n\nFor this request, rewrite only the single sentence inside <sentence>. Give three alternatives that differ clearly from each other and from the current wording, and that fit the surrounding passage in <context>. Each alternative must be one sentence that could replace the original in place.`;

  try {
    const result = await generateJson(
      resultSchema,
      {
        model: config.bestModel,
        effort: "low",
        maxTokens: 4000,
        system,
        user: `<context>\n${context}\n</context>\n\n<sentence>\n${sentence}\n</sentence>`,
      },
      { signal: request.signal },
    );
    const alternatives = result.alternatives
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== sentence.trim())
      .slice(0, 3);
    return Response.json({ alternatives });
  } catch (error) {
    console.error("alternatives failed", error);
    const { status, message } = describeApiError(error);
    return Response.json({ error: message }, { status });
  }
}
