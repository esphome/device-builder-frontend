/**
 * Schema-gated auto-fix for ESPHome invalid-option validation errors.
 *
 * `[key] is an invalid option for [api]. Please check the indentation.`
 * usually means the key was dedented one level out of its block (an empty
 * `encryption:` opener directly above). The buffer walk finds that shape;
 * the component catalog then has to confirm the key really is an option of
 * the opener (and not of its current parent) before the one-line re-indent
 * is offered — the gate fails closed, so packages / `!extend` / unknown
 * components simply get no fix rather than a wrong one.
 */
import type { EditorState } from "@codemirror/state";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { LocalizeFunc } from "../common/localize.js";
import { getKeyPath, resolveBundleContext } from "./yaml-ast.js";
import {
  loadCatalog,
  nestedPathForParent,
  resolveAvailableEntries,
} from "./yaml-completion-catalog.js";
import {
  analyzeDedentedOption,
  parseInvalidOptionMessage,
  type ReadLine,
  type ValueTypeCause,
} from "./yaml-error-analysis.js";
import { indentOf } from "./yaml-line-walker.js";

export interface InvalidOptionFixContext {
  api: ESPHomeAPI;
  state: EditorState;
  readLine: ReadLine;
  /** The sanitized validation-error message. */
  message: string;
  /** 1-indexed line the squiggle anchors on. */
  blamedLine: number;
  localize: LocalizeFunc;
}

/** Cause + one-click re-indent for a dedented option, or null when the
 *  buffer shape or the schema doesn't confirm it. Never throws. */
export async function describeInvalidOptionFix(
  ctx: InvalidOptionFixContext
): Promise<ValueTypeCause | null> {
  try {
    return await resolveFix(ctx);
  } catch {
    return null;
  }
}

async function resolveFix(ctx: InvalidOptionFixContext): Promise<ValueTypeCause | null> {
  const parsed = parseInvalidOptionMessage(ctx.message);
  if (!parsed) return null;
  const cand = analyzeDedentedOption(ctx.readLine, ctx.blamedLine, parsed.key);
  if (!cand) return null;

  const { state } = ctx;
  const doc = state.doc;
  if (ctx.blamedLine > doc.lines) return null;
  // Anchor inside each key token — side -1 at the line start would resolve
  // to the preceding node.
  const blamedPos = doc.line(ctx.blamedLine).from + cand.fromIndent + 1;
  const openerLineInfo = doc.line(cand.openerLine);
  const openerPos = openerLineInfo.from + indentOf(openerLineInfo.text) + 1;

  // The AST must agree with the line walk: the blamed key and the opener
  // are siblings under the same parent chain (rules out block scalars and
  // anything the indent heuristic misread).
  const blamedPath = getKeyPath(state, blamedPos);
  const openerPath = getKeyPath(state, openerPos);
  if (
    blamedPath[blamedPath.length - 1] !== parsed.key ||
    openerPath[openerPath.length - 1] !== cand.openerKey
  ) {
    return null;
  }
  if (
    blamedPath.length !== openerPath.length ||
    blamedPath.slice(0, -1).some((k, i) => openerPath[i] !== k)
  ) {
    return null;
  }
  // The message's [parent] names the blamed key's current parent; a
  // mismatch means the error belongs to another occurrence of this key.
  const topLevelKey = blamedPath[0];
  const currentParentKey =
    blamedPath.length >= 2 ? blamedPath[blamedPath.length - 2] : topLevelKey;
  if (parsed.parent !== currentParentKey) return null;

  const catalog = await loadCatalog(ctx.api);
  const platformValue = resolveBundleContext(state, openerPos)?.platformValue ?? null;
  // No CompletionTarget (board/platform): key existence doesn't vary by
  // board, and the linter doesn't carry one.
  const [openerEntries, parentEntries] = await Promise.all([
    resolveAvailableEntries(
      ctx.api,
      catalog,
      cand.openerKey,
      platformValue,
      topLevelKey,
      () => nestedPathForParent(state, openerPos, cand.openerKey)
    ),
    resolveAvailableEntries(
      ctx.api,
      catalog,
      currentParentKey,
      platformValue,
      topLevelKey,
      () => nestedPathForParent(state, blamedPos, currentParentKey)
    ),
  ]);
  if (!openerEntries.some((e) => e.key === parsed.key)) return null;
  if (parentEntries.some((e) => e.key === parsed.key)) return null;

  return {
    text: ctx.localize("yaml_editor.error_nest_under_fix", {
      line: ctx.blamedLine,
      key: parsed.key,
      parent: cand.openerKey,
      spaces: cand.delta,
    }),
    fix: {
      line: ctx.blamedLine,
      indent: cand.delta,
      key: parsed.key,
      fromIndent: cand.fromIndent,
    },
  };
}
