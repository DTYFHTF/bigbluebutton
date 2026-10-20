import { FALLBACK_BETA, MAX_WORDS, MODEL, describeApiError, getClient } from "@/lib/claude";
import { buildSystemPrompt, buildUserMessage, paraphraseRequestSchema } from "@/lib/prompt";
import { checkRateLimit, clientKey } from "@/lib/rateLimit";
import { countWords } from "@/lib/text";

export const runtime = "nodejs";

// The response is newline-delimited JSON so the client can tell text
// deltas apart from the final status or an error:
//   {"type":"delta","text":"..."}
//   {"type":"done","stopReason":"end_turn"}
//   {"type":"error","message":"..."}
export async function POST(request: Request) {
  const limit = checkRateLimit(clientKey(request.headers));
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
  if (words > MAX_WORDS) {
    return Response.json(
      { error: `That's ${words} words. The limit is ${MAX_WORDS} per request.` },
      { status: 413 },
    );
  }

  const stream = getClient().beta.messages.stream(
    {
      model: MODEL,
      // Rewrites are roughly input-length; "expand" can double it.
      max_tokens: Math.min(64000, Math.max(2048, words * 6)),
      output_config: { effort: "low" },
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      system: buildSystemPrompt(req),
      messages: [{ role: "user", content: buildUserMessage(req.text) }],
    },
    { signal: request.signal },
  );

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            send({ type: "delta", text: event.delta.text });
          }
        }
        const message = await stream.finalMessage();
        if (message.stop_reason === "refusal") {
          send({ type: "error", message: "This text couldn't be rewritten." });
        } else {
          send({ type: "done", stopReason: message.stop_reason });
        }
      } catch (error) {
        if (!request.signal.aborted) {
          console.error("paraphrase failed", error);
          send({ type: "error", message: describeApiError(error).message });
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
