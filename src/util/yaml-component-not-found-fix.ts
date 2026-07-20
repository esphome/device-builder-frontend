/**
 * Schema-gated auto-fix for ESPHome "Component not found" errors.
 *
 * `Component not found: id` on a column-0 key usually means an option
 * escaped the section above it (`logger:` then a dedented `id:`). The
 * component catalog has to confirm the key really is an option of that
 * section before the one-line indent is offered — the gate fails closed,
 * so a genuinely unknown component gets no fix rather than a wrong one.
 */
import type { Text } from "@codemirror/state";
import { getKeyPath } from "./yaml-ast.js";
import { loadCatalog, resolveAvailableEntries } from "./yaml-completion-catalog.js";
import {
  lineKeyToken,
  WALK_BOUND,
  YAML_INDENT_STEP,
  type ValueTypeCause,
} from "./yaml-error-analysis.js";
import type { YamlFixContext } from "./yaml-fix-context.js";
import {
  indentOf,
  RE_LIST_ITEM,
  RE_TOP_LEVEL_KEY,
  stripComment,
} from "./yaml-line-walker.js";

const COMPONENT_NOT_FOUND_RE = /^Component not found: ([A-Za-z0-9_]+)\.?$/;

/** Cause + one-click indent for a stray top-level key the section above
 *  accepts, or null when the buffer shape or the schema doesn't confirm
 *  it. Never throws. */
export async function describeComponentNotFoundFix(
  ctx: YamlFixContext
): Promise<ValueTypeCause | null> {
  try {
    return await resolveFix(ctx);
  } catch {
    return null;
  }
}

async function resolveFix(ctx: YamlFixContext): Promise<ValueTypeCause | null> {
  const parsed = ctx.message.match(COMPONENT_NOT_FOUND_RE);
  if (!parsed) return null;
  const key = parsed[1];
  const doc = ctx.state.doc;
  const blamedText = stripComment(doc.line(ctx.blamedLine).text);
  if (indentOf(blamedText) !== 0 || lineKeyToken(blamedText) !== key) return null;

  const opener = sectionOpenerAbove(doc, ctx.blamedLine);
  if (!opener) return null;
  const delta = childIndent(doc, opener.line, ctx.blamedLine);
  if (delta === null) return null;

  // The AST must agree the blamed key is a top-level mapping key (rules
  // out block scalars the line walk can't see). Anchor inside the key
  // token — side -1 at the line start would resolve to the preceding node.
  const blamedPath = getKeyPath(ctx.state, doc.line(ctx.blamedLine).from + 1);
  if (blamedPath.length !== 1 || blamedPath[0] !== key) return null;

  const catalog = await loadCatalog(ctx.api);
  // No platform / nested descent: the proposed parent is a top-level
  // mapping section, so its entries are the component's own options.
  const entries = await resolveAvailableEntries(
    ctx.api,
    catalog,
    opener.key,
    null,
    opener.key,
    () => []
  );
  if (!entries.some((e) => e.key === key)) return null;

  return {
    text: ctx.localize("yaml_editor.error_indent_under_section_fix", {
      line: ctx.blamedLine,
      key,
      section: opener.key,
      spaces: delta,
    }),
    fix: { line: ctx.blamedLine, indent: delta, key, fromIndent: 0 },
  };
}

/** Nearest column-0 line above *line* when it is a valueless
 *  ``section:`` opener; null when it's anything else (a complete
 *  ``key: value`` pair owns no block for the stray key to join).
 *  Not ``findTopLevelBlock``: that walk skips non-key column-0 lines
 *  and drops the line number this one needs. */
function sectionOpenerAbove(
  doc: Text,
  line: number
): { key: string; line: number } | null {
  for (let n = line - 1; n >= Math.max(1, line - WALK_BOUND); n--) {
    const stripped = stripComment(doc.line(n).text);
    if (!stripped.trim()) continue;
    if (indentOf(stripped) !== 0) continue;
    const m = stripped.match(RE_TOP_LEVEL_KEY);
    return m && stripped.slice(m[0].length).trim() === "" ? { key: m[1], line: n } : null;
  }
  return null;
}

/** Indent of the opener's first child (what the stray key should adopt);
 *  the canonical step for a childless opener, null for a list-shaped body
 *  (`sensor:` items give the stray key no single right target). */
function childIndent(doc: Text, openerLine: number, strayLine: number): number | null {
  for (let n = openerLine + 1; n < strayLine; n++) {
    const stripped = stripComment(doc.line(n).text);
    if (!stripped.trim()) continue;
    if (RE_LIST_ITEM.test(stripped)) return null;
    return indentOf(stripped);
  }
  return YAML_INDENT_STEP;
}
