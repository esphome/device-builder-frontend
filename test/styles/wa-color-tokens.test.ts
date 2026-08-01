/**
 * Every `--wa-color-*` token referenced under src/ must exist in the
 * WebAwesome styles tree. A phantom token is invisible to tsc and falls
 * back silently (or to a hard-coded color that ignores the theme); this
 * pins the vocabulary so the next typo fails a test instead of shipping.
 */
import { describe, expect, it } from "vitest";

const WA_STYLES_DIR = "node_modules/@home-assistant/webawesome/dist/styles";
const TOKEN_RE = /--wa-color-[a-z0-9-]+/g;

// Known phantoms awaiting the follow-up sweep; do not add to this list —
// fix the token instead.
const KNOWN_PHANTOMS = new Set([
  "--wa-color-border",
  "--wa-color-brand-text-quiet",
  "--wa-color-danger-border",
  "--wa-color-danger-text-normal",
  "--wa-color-neutral-500",
  "--wa-color-success-quiet",
  "--wa-color-surface-subtle",
  "--wa-color-text",
  "--wa-color-text-subtle",
  "--wa-color-warning-quiet",
]);

// Dynamic node imports: tsconfig's `types` pin excludes the node
// ambients, so the static form fails tsc (same shape as
// test/build-scripts/gen-language-manifest.test.ts).
async function collectTokens(): Promise<{
  defined: Set<string>;
  referenced: Set<string>;
}> {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");

  const walk = (dir: string, suffix: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path, suffix, out);
      else if (path.endsWith(suffix)) out.push(path);
    }
    return out;
  };

  const tokensIn = (paths: string[]): Set<string> => {
    const tokens = new Set<string>();
    for (const path of paths) {
      for (const match of readFileSync(path, "utf8").matchAll(TOKEN_RE)) {
        tokens.add(match[0]);
      }
    }
    return tokens;
  };

  return {
    defined: tokensIn(walk(WA_STYLES_DIR, ".css")),
    referenced: tokensIn(walk("src", ".ts")),
  };
}

describe("wa color tokens", () => {
  it("references only tokens the WebAwesome styles define", async () => {
    const { defined, referenced } = await collectTokens();
    const phantoms = [...referenced].filter(
      (token) => !defined.has(token) && !KNOWN_PHANTOMS.has(token)
    );
    expect(phantoms).toEqual([]);
  });

  it("keeps the phantom allowlist honest", async () => {
    const { defined, referenced } = await collectTokens();
    for (const token of KNOWN_PHANTOMS) {
      expect(defined.has(token)).toBe(false);
      expect(referenced.has(token)).toBe(true);
    }
  });
});
