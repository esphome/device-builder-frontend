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
 * Pair ``findTemplatesByAnchor`` with ``extractAttributeBindings``
 * to assert on the bindings of a specific element: the anchor
 * (``"<wa-option"``, ``"<wa-select"``, …) picks the templates
 * that emit that tag, and the extractor returns a name-keyed
 * map of attribute / property / boolean / event bindings parsed
 * from each static prefix string. Tests look up bindings by
 * name (``b.value``, ``b["?selected"]``, ``b[".label"]``,
 * ``b["@change"]``) so reordering attributes in the renderer
 * source doesn't silently break assertions —
 * ``components/device/_renderer-fixtures.ts``'s
 * ``findElementBindings`` is the convenience wrapper that
 * pairs the two for the common case.
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
export function visitTemplates(root: unknown, visit: (t: TemplateResult) => void): void {
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
export function findTemplatesByAnchor(root: unknown, anchor: string): TemplateResult[] {
  const matches: TemplateResult[] = [];
  visitTemplates(root, (t) => {
    if (t.strings.join("§").includes(anchor)) matches.push(t);
  });
  return matches;
}

/**
 * Extract attribute → value bindings from a Lit ``TemplateResult``.
 *
 * Each ``${...}`` expression in the template is preceded by a
 * static string. When that string ends with ``<name>=`` (with an
 * optional ``.`` / ``?`` / ``@`` Lit prefix and an optional
 * opening quote), the expression is the value bound to that
 * attribute / property / boolean attribute / event handler:
 *
 * | Prefix | Lit binding kind          | Key in returned map  |
 * |--------|---------------------------|----------------------|
 * | (none) | string attribute          | ``name``             |
 * | ``.``  | property                  | ``.name``            |
 * | ``?``  | boolean attribute         | ``?name``            |
 * | ``@``  | event listener            | ``@name``            |
 *
 * Mid-attribute-value bindings (``class="prefix ${...}"``,
 * concatenated values) are deliberately skipped — the helper only
 * surfaces "this expression IS the attribute's value" cases, which
 * is the contractual shape for renderer assertions.
 *
 * Tests look up bindings by name (``b.value``, ``b["?selected"]``,
 * ``b[".label"]``) without depending on the order the renderer
 * wrote the attributes in the template literal.
 */
export function extractAttributeBindings(t: TemplateResult): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (let i = 0; i < t.values.length; i++) {
    // The static string preceding `values[i]`. We only care about
    // its tail — Lit places the binding's attribute name there.
    const prefix = t.strings[i];
    // Match: optional Lit prefix char, attribute name (kebab/camel),
    // optional whitespace, ``=``, optional whitespace, optional
    // opening quote, optional whitespace, end-of-string. End-of-
    // string anchor is what makes this "this expression IS the
    // attribute's value" rather than "this expression is a piece
    // of a longer attribute value" (where the prefix ends with
    // text BEFORE the attribute boundary instead of right after
    // the ``=``).
    const m = prefix.match(/(\.|@|\?)?([\w-]+)\s*=\s*"?\s*$/);
    if (!m) continue;
    const [, sigil, name] = m;
    result[(sigil ?? "") + name] = t.values[i];
  }
  return result;
}
