import { Paraphraser } from "@/components/Paraphraser";
import { MAX_WORDS } from "@/lib/claude";

export const dynamic = "force-dynamic";

export default function Home() {
  return <Paraphraser maxWords={MAX_WORDS} />;
}
