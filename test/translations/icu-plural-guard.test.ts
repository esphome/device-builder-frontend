import { describe, expect, it } from "vitest";

import enMessages from "../../src/translations/en.json";

// Plural copy must use inline ICU MessageFormat (#1462), not the two legacy
// schemes #750 replaced: `(s)` lazy-plural placeholders and `_one`/`_other`
// suffix key pairs picked by hand in TS. These guards fail the build if either
// creeps back in. Tier-3 invariant strings (`{count} selected`, `({count})`)
// have no inflecting word and are intentionally not flagged.

function flatten(obj: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof obj !== "object" || obj === null) return out;
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

const ENTRIES = flatten(enMessages);

describe("en.json plural copy uses ICU MessageFormat (#1462)", () => {
  it("has no `(s)` / `(es)` lazy-plural placeholders", () => {
    const offenders = [...ENTRIES]
      .filter(([, value]) => /\w\(e?s\)/.test(value))
      .map(([path]) => path);
    expect(offenders, "use {count, plural, one {…} other {…}} instead").toEqual([]);
  });

  it("has no suffix-based plural key groups", () => {
    // Flag any stem carrying two or more plural-category suffixes
    // (`one`/`other`, `zero`/`one`, …) — a half-migration leaves a
    // partner behind. A lone suffix is left alone so non-plural enum
    // labels like `pin_group_other` ("Other pins") don't false-positive.
    const PLURAL_SUFFIXES = ["_zero", "_one", "_two", "_few", "_many", "_other"];
    const byStem = new Map<string, Set<string>>();
    for (const path of ENTRIES.keys()) {
      const suffix = PLURAL_SUFFIXES.find((s) => path.endsWith(s));
      if (!suffix) continue;
      const stem = path.slice(0, -suffix.length);
      let suffixes = byStem.get(stem);
      if (!suffixes) byStem.set(stem, (suffixes = new Set()));
      suffixes.add(suffix);
    }
    const offenders = [...byStem]
      .filter(([, suffixes]) => suffixes.size >= 2)
      .map(([stem]) => stem);
    expect(offenders, "collapse into one inline-ICU key").toEqual([]);
  });
});
