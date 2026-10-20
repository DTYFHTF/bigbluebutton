import { Paraphraser } from "@/components/Paraphraser";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function Home() {
  return <Paraphraser maxWords={config.maxWords} />;
}
