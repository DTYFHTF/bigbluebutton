import { z } from "zod";
import { config } from "@/lib/config";
import { learningStatus, startLearning } from "@/lib/learn";
import {
  activeGuide,
  addPhrases,
  learnedPhrases,
  listEvalRuns,
  listGuides,
  removePhrase,
  saveGuide,
  stats,
} from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    stats: stats(),
    guide: activeGuide(),
    guides: listGuides(),
    phrases: learnedPhrases(),
    evalRuns: listEvalRuns(),
    status: learningStatus(),
    models: {
      provider: config.providerLabel,
      fast: config.fastModel,
      best: config.bestModel,
      judge: config.judgeModel,
      candidates: config.candidates,
    },
    autoLearnEvery: config.autoLearnEvery,
  });
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("learn"), force: z.boolean().default(true) }),
  z.object({ action: z.literal("saveGuide"), rules: z.array(z.string().trim().min(1).max(500)).max(40) }),
  z.object({ action: z.literal("addPhrase"), phrase: z.string().trim().min(3).max(60), suggestion: z.string().trim().max(80) }),
  z.object({ action: z.literal("removePhrase"), phrase: z.string() }),
]);

export async function POST(request: Request) {
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const body = parsed.data;
  switch (body.action) {
    case "learn":
      // Runs in the background; the page polls GET for the outcome.
      startLearning({ force: body.force }).catch((error) => console.error("learning failed", error));
      break;
    case "saveGuide":
      saveGuide({ rules: body.rules, status: "manual", evalScore: null, baselineScore: null, summary: "Edited by hand" });
      break;
    case "addPhrase":
      addPhrases([{ phrase: body.phrase, suggestion: body.suggestion }]);
      break;
    case "removePhrase":
      removePhrase(body.phrase);
      break;
  }
  return Response.json({ ok: true, status: learningStatus() });
}
