import { learnedPhrases } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Learned robotic phrases, for the editor's highlighter.
export async function GET() {
  return Response.json({ phrases: learnedPhrases().map(({ phrase, suggestion }) => ({ phrase, suggestion })) });
}
