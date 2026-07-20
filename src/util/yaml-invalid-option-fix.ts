/**
 * Schema-gated auto-fix for ESPHome invalid-option validation errors.
 *
 * `[key] is an invalid option for [api]. Please check the indentation.`
 * usually means the key sits one indent level away from where it belongs:
 * dedented out of an empty opener directly above (`encryption:` then
 * `key:`), or over-indented into the block above (`variant:` swallowed by
 * `framework:`). The buffer walks find those shapes; the component catalog
 * then has to confirm the key really is an option of the proposed new
 * parent (and not of its current one) before the one-line re-indent is
 * offered — the gate fails closed, so packages / `!extend` / unknown
 * components simply get no fix rather than a wrong one.
 */
import { getKeyPath, getPlatformValue } from "./yaml-ast.js";
import { loadCatalog, resolveAvailableEntries } from "./yaml-completion-catalog.js";
import {
  analyzeDedentedOption,
  analyzeOverIndentedOption,
  parseInvalidOptionMessage,
  type DedentedOptionCandidate,
  type ReadLine,
  type ValueTypeCause,
} from "./yaml-error-analysis.js";
import type { YamlFixContext } from "./yaml-fix-context.js";
import { indentOf } from "./yaml-line-walker.js";

/** Cause + one-click re-indent for a misnested option, or null when the
 *  buffer shape or the schema doesn't confirm it. Never throws. */
export async function describeInvalidOptionFix(
  ctx: YamlFixContext
): Promise<ValueTypeCause | null> {
  try {
    return await resolveFix(ctx);
  } catch {
    return null;
  }
}

async function resolveFix(ctx: YamlFixContext): Promise<ValueTypeCause | null> {
  const parsed = parseInvalidOptionMessage(ctx.message);
  if (!parsed) return null;
  const doc = ctx.state.doc;
  const readLine: ReadLine = (n) =>
    n >= 1 && n <= doc.lines ? doc.line(n).text : undefined;
  const nest = analyzeDedentedOption(readLine, ctx.blamedLine, parsed.key);
  if (nest) {
    const fix = await gateCandidate(ctx, parsed, nest, true);
    if (fix) return fix;
  }
  const unnest = analyzeOverIndentedOption(readLine, ctx.blamedLine, parsed.key);
  return unnest ? gateCandidate(ctx, parsed, unnest, false) : null;
}

/**
 * Confirm a walk candidate against the AST and the component catalog and
 * build its cause. *nest* re-indents the blamed key under its sibling
 * opener; otherwise the key dedents out of its parent (the opener) to
 * become the grandparent's child.
 */
async function gateCandidate(
  ctx: YamlFixContext,
  parsed: { key: string; parent: string },
  cand: DedentedOptionCandidate,
  nest: boolean
): Promise<ValueTypeCause | null> {
  const { state } = ctx;
  const doc = state.doc;
  // Anchor inside each key token — side -1 at the line start would resolve
  // to the preceding node.
  const blamedPos = doc.line(ctx.blamedLine).from + cand.fromIndent + 1;
  const openerLineInfo = doc.line(cand.openerLine);
  const openerPos = openerLineInfo.from + indentOf(openerLineInfo.text) + 1;

  // The AST must agree with the line walk (rules out block scalars and
  // anything the indent heuristic misread): the opener is the blamed key's
  // sibling (nest) or its parent (unnest), and the message's [parent]
  // names the blamed key's current parent — a mismatch means the error
  // belongs to another occurrence of this key.
  const blamedPath = getKeyPath(state, blamedPos);
  const openerPath = getKeyPath(state, openerPos);
  const expectedOpener = nest
    ? [...blamedPath.slice(0, -1), cand.openerKey]
    : blamedPath.slice(0, -1);
  if (
    // Only the dedent needs a depth floor: its target is the grandparent.
    (!nest && blamedPath.length < 3) ||
    blamedPath[blamedPath.length - 1] !== parsed.key ||
    parsed.parent !== blamedPath[blamedPath.length - 2] ||
    openerPath.length !== expectedOpener.length ||
    openerPath.some((k, i) => expectedOpener[i] !== k)
  ) {
    return null;
  }

  const topLevelKey = blamedPath[0];
  const catalog = await loadCatalog(ctx.api);
  const platformValue = getPlatformValue(state, blamedPos);
  // No CompletionTarget (board/platform): key existence doesn't vary by
  // board, and the linter doesn't carry one. The nested descent paths are
  // the AST-verified key chains minus the top-level component.
  const entriesFor = (key: string, nestedPath: string[]) =>
    resolveAvailableEntries(
      ctx.api,
      catalog,
      key,
      platformValue,
      topLevelKey,
      () => nestedPath
    );
  // Where the key would move to: the opener (nest) or the opener's parent.
  const targetFull = nest ? openerPath : openerPath.slice(0, -1);
  const targetKey = targetFull[targetFull.length - 1];
  const [targetEntries, parentEntries] = await Promise.all([
    entriesFor(targetKey, targetFull.slice(1)),
    entriesFor(parsed.parent, blamedPath.slice(1, -1)),
  ]);
  if (!targetEntries.some((e) => e.key === parsed.key)) return null;
  if (parentEntries.some((e) => e.key === parsed.key)) return null;

  return {
    text: ctx.localize(
      nest ? "yaml_editor.error_nest_under_fix" : "yaml_editor.error_unnest_fix",
      {
        line: ctx.blamedLine,
        key: parsed.key,
        parent: parsed.parent,
        target: targetKey,
        spaces: Math.abs(cand.delta),
      }
    ),
    fix: {
      line: ctx.blamedLine,
      indent: cand.delta,
      key: parsed.key,
      fromIndent: cand.fromIndent,
    },
  };
}
