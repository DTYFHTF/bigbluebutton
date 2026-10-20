// Runs one learning round from the command line (the app also runs these
// automatically as feedback builds up).
//
//   npm run learn               # only if there is new feedback
//   npm run learn -- --force    # re-derive the guide even without new feedback

import { parseArgs } from "node:util";
import { startLearning } from "@/lib/learn";

const { values } = parseArgs({
  options: { force: { type: "boolean", default: false }, size: { type: "string", default: "6" } },
});

const result = await startLearning({ force: values.force, evalSize: Number(values.size) });
console.log(JSON.stringify(result, null, 2));
