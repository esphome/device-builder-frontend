import { splitYamlDocLines } from "./yaml-doc-lines.js";
import { splitInlineComment, stripQuotes } from "./yaml-scalar.js";
import { IGNORED_TOP_LEVEL_KEY_RE, TOP_LEVEL_KEY_RE } from "./yaml-section-lexer.js";

const _INSTANCE_SCALAR_RE = new Map<string, RegExp>();

/**
 * Value of a ``<key>: value`` line (surrounding quotes peeled), or ``null``.
 *
 * Allows an optional leading ``- `` list dash; ``id`` / ``platform`` take a
 * bare token, other keys (``name``) the rest of the line. A trailing inline
 * comment is stripped quote-aware (YAML's whitespace-preceded ``#`` rule):
 * ``name: a#b`` keeps ``a#b``, ``name: "Foo # b"`` keeps ``Foo # b``,
 * ``name: Foo  # bar`` keeps ``Foo``, ``name: # c`` is ``null`` (comment
 * only). Callers gate the line's indent.
 */
export function readInstanceScalar(line: string, key: string): string | null {
  const bareToken = key === "id" || key === "platform";
  let re = _INSTANCE_SCALAR_RE.get(key);
  if (re === undefined) {
    re = bareToken
      ? new RegExp(`^\\s*(?:-\\s+)?${key}:\\s*["']?(\\S+?)["']?(?:\\s+#.*)?\\s*$`)
      : new RegExp(`^\\s*(?:-\\s+)?${key}:\\s*(.*)$`);
    _INSTANCE_SCALAR_RE.set(key, re);
  }
  const m = line.match(re);
  if (!m) return null;
  if (bareToken) return m[1];
  const { value } = splitInlineComment(m[1]);
  const trimmed = value.trim();
  // Comment-only value (``name: # c``): the leading ``#`` isn't whitespace-
  // preceded, so splitInlineComment keeps it. Quoted ``"#x"`` starts with the quote.
  if (trimmed.startsWith("#")) return null;
  return stripQuotes(trimmed).trim() || null;
}

/**
 * Every value of an indented '<key>: value' line in *yaml*, as a set.
 * Best-effort line scan via readInstanceScalar, deliberately simple
 * (callers need a uniqueness pool, not a full parse). A real component
 * field is always indented under a block, so column-0 lines are never
 * collected. With *section* set, only lines under that top-level key
 * are collected; blank and comment lines don't end a section.
 */
export function collectInstanceScalars(
  yaml: string,
  key: string,
  section?: string
): Set<string> {
  const values = new Set<string>();
  if (!yaml) return values;
  let inSection = section === undefined;
  for (const line of splitYamlDocLines(yaml)) {
    if (!/^\s/.test(line)) {
      const top = line.match(TOP_LEVEL_KEY_RE);
      if (section !== undefined && (top || IGNORED_TOP_LEVEL_KEY_RE.test(line))) {
        inSection = top !== null && top[1] === section;
      }
      continue;
    }
    if (!inSection) continue;
    const value = readInstanceScalar(line, key);
    if (value !== null) values.add(value);
  }
  return values;
}
