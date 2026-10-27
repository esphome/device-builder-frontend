// Print the "Translations" section of the GitHub release notes.
//
//   node build-scripts/translation-release-notes.ts <previous-dir> <current-dir>
//
// Each directory holds locale files (`fr.json`, `zh_CN.json`, ...). The
// current directory's en.json is the base the completeness percentages are
// measured against. A missing previous directory counts as empty, so every
// language reads as new. Prints nothing when no language changed.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BASE_LANGUAGE, toBcp47, translationReleaseNotes } from "./translations-lib.ts";

type Messages = Record<string, unknown>;

function readJson(path: string): Messages {
  return JSON.parse(readFileSync(path, "utf-8")) as Messages;
}

// Read every locale file in `dir` (except the base language), keyed by
// canonical BCP 47 code. A missing directory yields no locales.
function readLocales(dir: string): Record<string, Messages> {
  const out: Record<string, Messages> = {};
  if (!existsSync(dir)) {
    return out;
  }
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json") || name === `${BASE_LANGUAGE}.json`) {
      continue;
    }
    out[toBcp47(name.replace(/\.json$/, ""))] = readJson(join(dir, name));
  }
  return out;
}

function main(): void {
  const [previousDir, currentDir, ...rest] = process.argv.slice(2);
  if (!previousDir || !currentDir || rest.length > 0) {
    console.error(
      "Usage: node build-scripts/translation-release-notes.ts <previous-dir> <current-dir>"
    );
    process.exit(1);
  }
  const base = readJson(join(currentDir, `${BASE_LANGUAGE}.json`));
  const notes = translationReleaseNotes(
    base,
    readLocales(previousDir),
    readLocales(currentDir)
  );
  if (notes) {
    process.stdout.write(notes);
  }
}

main();
