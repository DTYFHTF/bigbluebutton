import { describeApiError } from "@/lib/llm";
import { config } from "@/lib/config";
import { runPipeline, type PipelineEvent } from "@/lib/pipeline";
import { paraphraseRequestSchema } from "@/lib/prompt";
import { checkRateLimit, clientKey } from "@/lib/rateLimit";
import { countWords } from "@/lib/text";

export const runtime = "nodejs";
export const maxDuration = 300;

// The response is newline-delimited JSON: pipeline events (stage, delta,
// reset, result) followed by {"type":"done"}, or {"type":"error"}.
export async function POST(request: Request) {
  const limit = checkRateLimit(clientKey(request.headers), config.rateLimitPerMin);
  if (!limit.ok) {
    return Response.json(
      { error: `Too many requests. Try again in ${limit.retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const parsed = paraphraseRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const req = parsed.data;

  const words = countWords(req.text);
  if (config.maxWords > 0 && words > config.maxWords) {
    return Response.json(
      { error: `That's ${words} words. The limit is ${config.maxWords} per request.` },
      { status: 413 },
    );
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: PipelineEvent | { type: "done" } | { type: "error"; message: string }) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        await runPipeline(req, { emit: send, signal: request.signal });
        send({ type: "done" });
      } catch (error) {
        if (!request.signal.aborted) {
          console.error("paraphrase failed", error);
          send({ type: "error", message: describeApiError(error).message });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
