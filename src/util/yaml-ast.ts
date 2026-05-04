/**
 * Tiny AST helpers around the Lezer YAML tree the editor already
 * builds for syntax highlighting (``esphome-yaml-lang.ts`` wires
 * the parser; ``syntaxTree(state)`` returns it). Used by the
 * autocompletion source to answer structural questions:
 *
 *   - "what's the top-level YAML key the cursor sits under?"
 *   - "is the cursor a list-item directly under a ``then:`` block?"
 *   - "what's the value of a sibling ``platform:`` pair?"
 *
 * The pre-existing completion helpers in ``yaml-completion.ts``
 * use indent / regex heuristics. AST traversal is more robust on
 * the edges that matter here:
 *
 *   - block scalars (``key: |``) inside which an indented ``key:``
 *     line is content, not a real key — regex confuses them; AST
 *     parses them as ``BlockLiteralContent``.
 *   - quoted keys (``"weird key": value``) — regex requires the
 *     ``[A-Za-z0-9_]`` character class; AST treats ``Key`` as a
 *     wrapper around any literal.
 *   - inline comments and trailing whitespace — already filtered
 *     by the parser before we get here.
 *
 * Lezer's tree is incremental and always present (even on partial
 * / invalid YAML, error recovery produces an ``⚠`` node), so the
 * caller doesn't need a fallback for "the parse failed".
 */
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

/** Read the textual value of a ``Key`` node, stripping surrounding
 *  quotes if it wraps a ``QuotedLiteral``. Returns ``null`` for
 *  non-scalar keys (block-mapping / sequence keys are valid YAML
 *  but never component-name keys we'd want to match here). */
export function readKeyText(
  state: EditorState,
  key: SyntaxNode,
): string | null {
  // ``Key`` wraps an ``element`` — the literal we care about is
  // its first leaf-ish child (Literal / QuotedLiteral).
  let inner: SyntaxNode | null = key.firstChild;
  if (!inner) return null;
  // Skip Tagged / Anchored wrappers.
  while (
    inner &&
    (inner.name === "Tagged" ||
      inner.name === "Anchored" ||
      inner.name === "Tag" ||
      inner.name === "Anchor")
  ) {
    inner = inner.firstChild ?? inner.nextSibling;
  }
  if (!inner) return null;
  if (inner.name !== "Literal" && inner.name !== "QuotedLiteral") return null;
  let text = state.doc.sliceString(inner.from, inner.to);
  if (inner.name === "QuotedLiteral" && text.length >= 2) {
    const q = text[0];
    if ((q === '"' || q === "'") && text[text.length - 1] === q) {
      text = text.slice(1, -1);
    }
  }
  return text;
}

/** Walk up from any node to the nearest enclosing ``Pair``. */
export function findEnclosingPair(
  node: SyntaxNode | null,
): SyntaxNode | null {
  let cur = node;
  while (cur && cur.name !== "Pair") cur = cur.parent;
  return cur;
}

/** Read the ``Key`` text of a ``Pair`` directly. */
export function getPairKey(
  state: EditorState,
  pair: SyntaxNode,
): string | null {
  const key = pair.getChild("Key");
  if (!key) return null;
  return readKeyText(state, key);
}

/**
 * Walk up from the cursor's deepest node to the top-level
 * ``Pair`` — the one whose grandparent (``BlockMapping`` →
 * parent) is the ``Document``. Returns ``null`` if the cursor
 * isn't nested under a top-level mapping (e.g. unparseable
 * single-line input).
 */
export function findTopLevelPair(
  node: SyntaxNode | null,
): SyntaxNode | null {
  let cur = findEnclosingPair(node);
  while (cur) {
    const map = cur.parent;
    if (map?.name === "BlockMapping" && map.parent?.name === "Document") {
      return cur;
    }
    cur = findEnclosingPair(map?.parent ?? null);
  }
  return null;
}

/**
 * True when *pos* is inside (or precedes the value of) a list
 * ``Item`` whose parent ``BlockSequence`` is the value of a
 * ``Pair`` whose ``Key`` reads ``then``. Mirrors the legacy
 * dashboard's ``addRegistry({registry: "action"})`` trigger:
 * action-registry completion fires only at this structural
 * position.
 *
 * Doesn't validate that the ``then:`` lives under a
 * ``type: trigger`` config-var — script's ``then:`` and a few
 * other automation-shaped contexts share the same body, and
 * mistaking those is harmless (worst case: a few extra valid
 * completion entries the user can ignore).
 */
export function isUnderThenItem(state: EditorState, pos: number): boolean {
  const node = syntaxTree(state).resolveInner(pos, -1);
  let cur: SyntaxNode | null = node;
  while (cur) {
    if (cur.name === "Item") {
      const seq = cur.parent;
      if (seq?.name === "BlockSequence") {
        const pair = seq.parent;
        if (pair?.name === "Pair" && getPairKey(state, pair) === "then") {
          return true;
        }
      }
    }
    cur = cur.parent;
  }
  return false;
}

/**
 * Resolve the bundle context for a cursor position: the top-level
 * component name (``binary_sensor``, ``esphome``, …) plus the
 * ``platform:`` value if the cursor sits inside a list-item that
 * declares one (``binary_sensor: - platform: gpio``). Returns
 * ``null`` for "no top-level pair on the way up" (e.g. cursor at
 * the very top of an empty doc).
 */
export function resolveBundleContext(
  state: EditorState,
  pos: number,
): { topLevelKey: string; platformValue: string | null } | null {
  const node = syntaxTree(state).resolveInner(pos, -1);
  const top = findTopLevelPair(node);
  if (!top) return null;
  const topKey = getPairKey(state, top);
  if (!topKey) return null;
  // Look for an enclosing list-item with a sibling ``platform: <x>``.
  let platformValue: string | null = null;
  let cur: SyntaxNode | null = node;
  while (cur && cur !== top) {
    if (cur.name === "Item") {
      // The Item's value should be a BlockMapping (list of mappings).
      const map = cur.firstChild;
      if (map?.name === "BlockMapping") {
        for (
          let pair = map.firstChild;
          pair;
          pair = pair.nextSibling
        ) {
          if (pair.name !== "Pair") continue;
          if (getPairKey(state, pair) !== "platform") continue;
          // Read the value — the Pair's last Literal/QuotedLiteral child.
          let v: SyntaxNode | null = pair.lastChild;
          while (
            v &&
            v.name !== "Literal" &&
            v.name !== "QuotedLiteral"
          ) {
            v = v.prevSibling;
          }
          if (v) {
            let text = state.doc.sliceString(v.from, v.to);
            if (v.name === "QuotedLiteral" && text.length >= 2) {
              const q = text[0];
              if ((q === '"' || q === "'") && text[text.length - 1] === q) {
                text = text.slice(1, -1);
              }
            }
            platformValue = text;
          }
          break;
        }
      }
      break;
    }
    cur = cur.parent;
  }
  return { topLevelKey: topKey, platformValue };
}

/**
 * Collect the keys of all top-level ``Pair``s in the document.
 * Used by the action-registry walker to know which schema bundles
 * to aggregate from (the legacy editor's ``getDocComponents`` —
 * actions follow the components actually present in the user's
 * config).
 */
export function collectTopLevelKeys(state: EditorState): string[] {
  const tree = syntaxTree(state);
  const out: string[] = [];
  const seen = new Set<string>();
  // Stream → Document → BlockMapping → Pair*
  const doc = tree.topNode.getChild("Document");
  if (!doc) return out;
  const map = doc.getChild("BlockMapping");
  if (!map) return out;
  for (let pair = map.firstChild; pair; pair = pair.nextSibling) {
    if (pair.name !== "Pair") continue;
    const k = getPairKey(state, pair);
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}
