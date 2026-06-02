import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Vitest global setup: regenerate the language manifest before the suite
// runs. src/common/localize.ts statically imports
// src/generated/language-manifest.json, which is gitignored and generated
// from src/translations/*.json (see build-scripts/gen-language-manifest.cjs).
// Running it here keeps `npm test`, `test:watch`, and a bare `npx vitest` all
// working from a fresh checkout. Kept as .mjs (not .ts) so it stays outside
// the tsconfig `include`, matching how build-scripts/*.ts use node builtins
// without being type-checked.
export default function setup() {
  const script = fileURLToPath(
    new URL("../build-scripts/gen-language-manifest.cjs", import.meta.url)
  );
  // Inherit stderr so a generator failure (bad JSON, missing dir) surfaces
  // its error instead of just a bare non-zero-exit throw; success output on
  // stdout stays quiet to avoid noise before the suite runs.
  execFileSync(process.execPath, [script], { stdio: ["ignore", "ignore", "inherit"] });
}
