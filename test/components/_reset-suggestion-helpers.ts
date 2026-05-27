/**
 * Shared helpers for the build-failure-hint renderer tests.
 *
 * Both ``command-dialog`` and ``firmware-install-dialog`` drive the same
 * three-way assertion shape against the ``.reset-suggestion`` template
 * the renderers emit (local two-link variant / remote receiver-label
 * variant / no-hint), so the localize stub and the assertion patterns
 * live here rather than getting copy-pasted across the two test files.
 */
import { expect } from "vitest";
import type { TemplateResult } from "lit";
import enMessages from "../../src/translations/en.json";
import { findTemplatesByAnchor } from "../_lit-template-walker.js";

const RESET_SUGGESTION_ANCHOR = 'class="reset-suggestion"';

/**
 * Mirror the runtime ``_localize`` resolver against the bundled
 * ``en.json`` source so the renderer sees the same template strings
 * (with placeholder tokens) production loads.
 */
export const localize = (
  key: string,
  values?: Record<string, string | number>
): string => {
  const parts = key.split(".");
  let cur: unknown = enMessages as unknown;
  for (const p of parts) {
    if (cur && typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      cur = undefined;
      break;
    }
  }
  const text = typeof cur === "string" ? cur : key;
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? `{${k}}`));
};

export type LocalizeFn = typeof localize;

interface SuggestionHandlers {
  _tryCleanBuild: () => void;
  _tryResetBuildEnv: () => void;
}

/** Assert the LOCAL two-link variant rendered (clean + reset). */
export function expectLocalSuggestion(
  tree: TemplateResult | typeof import("lit").nothing,
  host: SuggestionHandlers
): void {
  const matches = findTemplatesByAnchor(tree, RESET_SUGGESTION_ANCHOR);
  expect(matches.length).toBe(1);
  const values = matches[0].values;
  expect(values).toContain(host._tryCleanBuild);
  expect(values).toContain(host._tryResetBuildEnv);
}

/**
 * Assert the REMOTE receiver-label variant rendered: clean link still
 * present (db#608 fans clean out), reset link absent (would wipe the
 * wrong machine's cache), receiver label inlined as plain text.
 */
export function expectRemoteSuggestion(
  tree: TemplateResult | typeof import("lit").nothing,
  host: SuggestionHandlers,
  receiver: string
): void {
  const matches = findTemplatesByAnchor(tree, RESET_SUGGESTION_ANCHOR);
  expect(matches.length).toBe(1);
  const values = matches[0].values;
  expect(values).toContain(host._tryCleanBuild);
  expect(values).not.toContain(host._tryResetBuildEnv);
  expect(values).toContain(receiver);
}

/**
 * Assert the renderer fell back to the LOCAL variant (reset link
 * present) — used when source is REMOTE but label is empty, or when
 * neither live nor primed snapshot resolves a source.
 */
export function expectFallbackToLocal(
  tree: TemplateResult | typeof import("lit").nothing,
  host: SuggestionHandlers
): void {
  const matches = findTemplatesByAnchor(tree, RESET_SUGGESTION_ANCHOR);
  expect(matches.length).toBe(1);
  expect(matches[0].values).toContain(host._tryResetBuildEnv);
}

/** Assert no build-failure hint rendered (user-stopped, peer-link lost, …). */
export function expectNoSuggestion(
  tree: TemplateResult | typeof import("lit").nothing
): void {
  expect(findTemplatesByAnchor(tree, RESET_SUGGESTION_ANCHOR).length).toBe(0);
}
