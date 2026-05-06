/**
 * Generic walker for Lit ``TemplateResult`` trees.
 *
 * Lets renderer tests inspect what a template produced without
 * mounting a DOM (which we can't do reliably for our wa-* form
 * components — wa-select's form-associated base relies on
 * ``ElementInternals.validity`` that happy-dom doesn't implement).
 *
 * The walker recurses through ``.values`` (where Lit stashes
 * interpolated expressions, including nested templates and arrays
 * of templates from ``items.map(...)``) and visits every
 * ``TemplateResult`` it finds, in document order.
 *
 * Pair this with a per-tag matcher that picks templates whose
 * static ``.strings`` contain the element opening you care about
 * (``"<wa-option"``, ``"<wa-select"``, …) and pulls the bound
 * values out of ``.values`` by their position in the template
 * literal. The shape of the renderer's html is what defines the
 * indexes — see ``extractWaOptionBindings`` in
 * ``components/device/_renderer-fixtures.ts`` for the pin
 * renderer's mapping.
 */
import type { TemplateResult } from "lit";

/** Type-guard: does *value* look like a Lit ``TemplateResult``? */
export function isTemplateResult(value: unknown): value is TemplateResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "_$litType$" in (value as Record<string, unknown>) &&
    "strings" in (value as Record<string, unknown>) &&
    "values" in (value as Record<string, unknown>)
  );
}

/** Recursively visit every ``TemplateResult`` reachable from *root*.
 *
 * *root* may be a single template, an array (e.g. the result of
 * ``items.map(...)``), or any value at all — non-templates and
 * non-arrays are skipped. Order matches Lit's render order:
 * parents before their interpolated children.
 */
export function visitTemplates(
  root: unknown,
  visit: (t: TemplateResult) => void,
): void {
  if (!root) return;
  if (Array.isArray(root)) {
    for (const r of root) visitTemplates(r, visit);
    return;
  }
  if (isTemplateResult(root)) {
    visit(root);
    visitTemplates(root.values, visit);
  }
}

/** Convenience wrapper: collect every template whose static
 *  ``strings`` join contains *anchor*.
 *
 *  Each template literal Lit produces has a ``.strings`` array of
 *  the static text fragments between expressions. Joining those
 *  back together and string-matching against the element opening
 *  (``"<wa-option"``, ``"<wa-select"``, …) is a cheap reliable
 *  way to find the templates that emit the tag you care about,
 *  without parsing the lit-html grammar yourself.
 */
export function findTemplatesByAnchor(
  root: unknown,
  anchor: string,
): TemplateResult[] {
  const matches: TemplateResult[] = [];
  visitTemplates(root, (t) => {
    if (t.strings.join("§").includes(anchor)) matches.push(t);
  });
  return matches;
}
