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

/**
 * Slice the literal text of a ``Literal`` / ``QuotedLiteral`` node
 * and strip the surrounding quotes if any. Shared between the
 * ``Key`` reader and the ``platform:`` value reader (both want the
 * same shape: text with quotes peeled).
 */
function readLiteralText(state: EditorState, node: SyntaxNode): string {
  let text = state.doc.sliceString(node.from, node.to);
  if (node.name === "QuotedLiteral" && text.length >= 2) {
    const q = text[0];
    if ((q === '"' || q === "'") && text[text.length - 1] === q) {
      text = text.slice(1, -1);
    }
  }
  return text;
}

/** Read the textual value of a ``Key`` node, stripping surrounding
 *  quotes if it wraps a ``QuotedLiteral``. Returns ``null`` for
 *  non-scalar keys (block-mapping / sequence keys are valid YAML
 *  but never component-name keys we'd want to match here). */
export function readKeyText(state: EditorState, key: SyntaxNode): string | null {
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
  return readLiteralText(state, inner);
}

/** Walk up from any node to the nearest enclosing ``Pair``. */
export function findEnclosingPair(node: SyntaxNode | null): SyntaxNode | null {
  let cur = node;
  while (cur && cur.name !== "Pair") cur = cur.parent;
  return cur;
}

/** Read the ``Key`` text of a ``Pair`` directly. */
export function getPairKey(state: EditorState, pair: SyntaxNode): string | null {
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
export function findTopLevelPair(node: SyntaxNode | null): SyntaxNode | null {
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
  return isUnderAutomationItem(state, pos);
}

/** Pattern for automation-shaped pair keys: ``then`` / ``else``
 *  / ``on_*`` / ``*_action`` (cover ``open_action`` /
 *  ``close_action``, lock ``unlock_action``, …). Covers every
 *  list-of-actions body in the ESPHome schema; broader than the
 *  legacy ``then``-only carve-out. */
const RE_AUTOMATION_KEY = /^(?:then|else|on_[a-z0-9_]*|[a-z0-9_]+_action)$/;

/**
 * True when *pos* is inside a list ``Item`` whose enclosing Pair
 * is an automation-shaped key. Generalised from the legacy
 * ``then``-only carve-out so cover ``open_action:`` /
 * ``close_action:`` / ``stop_action:`` and similar
 * ``*_action:`` bodies fire the action-registry too. Action
 * arguments inside those items are part of the action's own
 * schema, not the registry — the source still gates on the
 * list-item position via ``isListItem`` so this only triggers
 * the registry at the dash position.
 */
export function isUnderAutomationItem(state: EditorState, pos: number): boolean {
  const node = syntaxTree(state).resolveInner(pos, -1);
  let cur: SyntaxNode | null = node;
  while (cur) {
    if (cur.name === "Item") {
      const seq = cur.parent;
      if (seq?.name === "BlockSequence") {
        const pair = seq.parent;
        if (pair?.name === "Pair") {
          const key = getPairKey(state, pair);
          if (key && RE_AUTOMATION_KEY.test(key)) return true;
        }
      }
    }
    cur = cur.parent;
  }
  return false;
}

/**
 * Read the top-level component name the cursor lives under
 * (``binary_sensor``, ``esphome``, …). Returns ``null`` when the
 * cursor isn't nested under a top-level mapping pair (e.g.
 * cursor at the very top of an empty doc).
 */
export function getTopLevelKey(state: EditorState, pos: number): string | null {
  const node = syntaxTree(state).resolveInner(pos, -1);
  const top = findTopLevelPair(node);
  if (!top) return null;
  return getPairKey(state, top);
}

/**
 * Read the ``platform:`` value of the enclosing list-item, if any
 * (``binary_sensor: - platform: gpio`` → ``"gpio"``). Returns
 * ``null`` when the cursor isn't inside a list-item that declares
 * a ``platform:`` sibling.
 */
export function getPlatformValue(state: EditorState, pos: number): string | null {
  // Walk up through every enclosing ``Item`` until one has a
  // ``platform:`` pair as a direct child of its mapping. Inner
  // list-of-mappings positions (cursor inside a ``filters:`` /
  // ``then:`` item nested under ``- platform: gpio``) need to
  // skip over the inner items to reach the outer
  // platform-declaring one — without that, registry / config-var
  // completion can't resolve the platform context.
  let cur: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  while (cur) {
    while (cur && cur.name !== "Item") cur = cur.parent;
    if (!cur) return null;
    const map = cur.firstChild;
    if (map?.name === "BlockMapping") {
      for (let pair = map.firstChild; pair; pair = pair.nextSibling) {
        if (pair.name !== "Pair") continue;
        if (getPairKey(state, pair) !== "platform") continue;
        let v: SyntaxNode | null = pair.lastChild;
        while (v && v.name !== "Literal" && v.name !== "QuotedLiteral") {
          v = v.prevSibling;
        }
        return v ? readLiteralText(state, v) : null;
      }
    }
    // No ``platform:`` here — keep walking up.
    cur = cur.parent;
  }
  return null;
}

/**
 * Resolve the bundle context for a cursor position: the top-level
 * component name plus the ``platform:`` value if the cursor sits
 * inside a list-item that declares one. Thin combinator over
 * ``getTopLevelKey`` and ``getPlatformValue`` — kept for the
 * common "I want both" callsite. Returns ``null`` for "no
 * top-level pair on the way up".
 */
export function resolveBundleContext(
  state: EditorState,
  pos: number
): { topLevelKey: string; platformValue: string | null } | null {
  const topLevelKey = getTopLevelKey(state, pos);
  if (!topLevelKey) return null;
  return { topLevelKey, platformValue: getPlatformValue(state, pos) };
}

/** Memoise substitution-key collection by Lezer ``Tree`` identity.
 *  Same incremental-tree reuse as ``collectTopLevelKeys`` —
 *  unchanged ``substitutions:`` mapping shouldn't re-walk on every
 *  keystroke. */
const substitutionKeysMemo = new WeakMap<object, string[]>();

/**
 * Read every key declared under the doc's ``substitutions:``
 * mapping. Drives the ``${…}`` reference completion at value
 * position — typing ``${id_pre`` should suggest ``id_prefix``
 * if the doc declares it.
 */
export function collectSubstitutionKeys(state: EditorState): string[] {
  const tree = syntaxTree(state);
  const cached = substitutionKeysMemo.get(tree);
  if (cached) return cached;
  const out: string[] = [];
  const seen = new Set<string>();
  const doc = tree.topNode.getChild("Document");
  const map = doc?.getChild("BlockMapping");
  if (!map) {
    substitutionKeysMemo.set(tree, out);
    return out;
  }
  for (let pair = map.firstChild; pair; pair = pair.nextSibling) {
    if (pair.name !== "Pair") continue;
    if (getPairKey(state, pair) !== "substitutions") continue;
    // ``substitutions:`` value is a BlockMapping of leaf pairs.
    let val: SyntaxNode | null = pair.lastChild;
    while (val && val.name !== "BlockMapping") val = val.prevSibling;
    if (!val) break;
    for (let inner = val.firstChild; inner; inner = inner.nextSibling) {
      if (inner.name !== "Pair") continue;
      const k = getPairKey(state, inner);
      if (k && !seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
    break;
  }
  substitutionKeysMemo.set(tree, out);
  return out;
}

/** Memoise top-level-key collection by Lezer ``Tree`` identity.
 *  Lezer's incremental parsing reuses the same ``Tree`` object
 *  across edits that don't touch the relevant subtree, so a
 *  ``WeakMap`` keyed by tree avoids re-walking the document's
 *  top-level mapping on every keystroke. The list is small
 *  (handful of entries) so storing the resolved array is cheap. */
const topLevelKeysMemo = new WeakMap<object, string[]>();

/**
 * Collect the keys of all top-level ``Pair``s in the document.
 * Used by the action-registry walker to know which schema bundles
 * to aggregate from (the legacy editor's ``getDocComponents`` —
 * actions follow the components actually present in the user's
 * config).
 */
export function collectTopLevelKeys(state: EditorState): string[] {
  const tree = syntaxTree(state);
  const cached = topLevelKeysMemo.get(tree);
  if (cached) return cached;
  const out: string[] = [];
  const seen = new Set<string>();
  // Stream → Document → BlockMapping → Pair*
  const doc = tree.topNode.getChild("Document");
  if (!doc) {
    topLevelKeysMemo.set(tree, out);
    return out;
  }
  const map = doc.getChild("BlockMapping");
  if (!map) {
    topLevelKeysMemo.set(tree, out);
    return out;
  }
  for (let pair = map.firstChild; pair; pair = pair.nextSibling) {
    if (pair.name !== "Pair") continue;
    const k = getPairKey(state, pair);
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  topLevelKeysMemo.set(tree, out);
  return out;
}
