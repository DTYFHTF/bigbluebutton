import { z } from "zod";
import { config } from "@/lib/config";
import { learningStatus, startLearning } from "@/lib/learn";
import { countPendingFeedback, recordFeedback } from "@/lib/store";

export const runtime = "nodejs";

const feedbackSchema = z.object({
  runId: z.string().min(1),
  rating: z.union([z.literal(-1), z.literal(0), z.literal(1)]).optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  finalOutput: z.string().max(200_000).nullable().optional(),
});

// Records a rating, note or hand-edited final version for a rewrite, and
// kicks off a learning round once enough new feedback has built up.
export async function POST(request: Request) {
  const parsed = feedbackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const { runId, ...feedback } = parsed.data;
  if (feedback.note === "") feedback.note = null;
  if (!recordFeedback(runId, feedback)) {
    return Response.json({ error: "Unknown rewrite." }, { status: 404 });
  }

  const pending = countPendingFeedback();
  let learning = false;
  if (config.autoLearnEvery > 0 && pending >= config.autoLearnEvery && !learningStatus().running) {
    startLearning().catch((error) => console.error("auto-learn failed", error));
    learning = true;
  }
  return Response.json({ ok: true, pending, learning });
}
