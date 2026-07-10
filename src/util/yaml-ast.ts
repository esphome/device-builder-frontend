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

/** True for pair keys whose value is a list of actions: ``then`` /
 *  ``else`` / ``on_*`` / ``*_action``. The indent-based completion
 *  fallback uses this when the Lezer parse mis-nests an empty trailing
 *  ``- `` and ``isUnderAutomationItem`` can't see the enclosing key. */
export function isAutomationKey(key: string): boolean {
  return RE_AUTOMATION_KEY.test(key);
}

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
          if (key && isAutomationKey(key)) return true;
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
 * Collect the key chain from the top-level mapping down to the pair
 * enclosing *pos* (``esp32_ble_tracker`` → ``scan_parameters`` →
 * ``active``). Returns ``[]`` when *pos* isn't inside a mapping pair.
 * List-item wrappers contribute no key — only ``Pair`` keys land in
 * the chain — so a field under ``- platform: gpio`` yields
 * ``[<domain>, <field>]``, matching how the schema nests platform
 * fields directly under the component.
 */
export function getKeyPath(state: EditorState, pos: number): string[] {
  const keys: string[] = [];
  let cur = findEnclosingPair(resolveAnchoredNode(state, pos));
  while (cur) {
    const k = getPairKey(state, cur);
    if (k) keys.push(k);
    cur = findEnclosingPair(cur.parent?.parent ?? null);
  }
  return keys.reverse();
}

/**
 * Like ``getKeyPath``, but block-sequence items contribute their
 * numeric index, so a field inside ``esphome: areas: - id:`` yields
 * ``["esphome", "areas", 0, "id"]`` — the shape value paths use for
 * fields nested in list entries.
 */
export function getKeyPathWithListIndices(
  state: EditorState,
  pos: number
): (string | number)[] {
  const segs: (string | number)[] = [];
  for (let node = resolveAnchoredNode(state, pos); node; node = node.parent) {
    if (node.name === "Pair") {
      const k = getPairKey(state, node);
      if (k) segs.push(k);
    } else if (node.name === "Item" && node.parent?.name === "BlockSequence") {
      let idx = 0;
      for (let s = node.prevSibling; s; s = s.prevSibling) {
        if (s.name === "Item") idx++;
      }
      segs.push(idx);
    }
  }
  return segs.reverse();
}

/**
 * The deepest node at *pos*, re-anchored for the empty-value case: a
 * cursor in an empty value / trailing whitespace (``key: ``) resolves
 * past the line's own pair — to the document root at EOF, or to an
 * enclosing container mid-document — so re-resolve on the line's last
 * non-space char (the ``:`` or key). The enclosing-pair check alone
 * can't detect the mid-document case: the container has an ancestor
 * pair, just the wrong one.
 */
function resolveAnchoredNode(state: EditorState, pos: number): SyntaxNode | null {
  const tree = syntaxTree(state);
  const node: SyntaxNode | null = tree.resolveInner(pos, -1);
  const line = state.doc.lineAt(pos);
  const upto = line.text.slice(0, pos - line.from).trimEnd();
  if (!upto) return node;
  const anchor = line.from + upto.length - 1;
  if (pos - line.from > upto.length) return tree.resolveInner(anchor, -1);
  if (findEnclosingPair(node)) return node;
  return tree.resolveInner(anchor, -1);
}

/**
 * Whether *pos* sits inside a block scalar's content (a ``key: |`` / ``>``
 * body), where an indented ``key:``-looking line is literal text, not a real
 * pair. Indent-based path resolvers (which the regex can't tell apart from a
 * field) must defer to the AST here — Lezer parses the body as ``BlockLiteral``.
 */
export function isInsideBlockScalar(state: EditorState, pos: number): boolean {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  while (node) {
    if (node.name === "BlockLiteral" || node.name === "BlockLiteralContent") {
      return true;
    }
    node = node.parent;
  }
  return false;
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

/** Iterate the direct ``Pair`` children of a ``BlockMapping`` node — the
 *  shared primitive behind the mapping-key collectors below. */
function* mappingPairs(map: SyntaxNode): Generator<SyntaxNode> {
  for (let pair = map.firstChild; pair; pair = pair.nextSibling) {
    if (pair.name === "Pair") yield pair;
  }
}

/** Ordered, de-duplicated keys of a ``BlockMapping``'s direct pairs. */
function uniqueMappingKeys(state: EditorState, map: SyntaxNode): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const pair of mappingPairs(map)) {
    const k = getPairKey(state, pair);
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
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
  const map = tree.topNode.getChild("Document")?.getChild("BlockMapping");
  for (const pair of map ? mappingPairs(map) : []) {
    if (getPairKey(state, pair) !== "substitutions") continue;
    // ``substitutions:`` value is a BlockMapping of leaf pairs.
    let val: SyntaxNode | null = pair.lastChild;
    while (val && val.name !== "BlockMapping") val = val.prevSibling;
    if (val) out.push(...uniqueMappingKeys(state, val));
    break;
  }
  substitutionKeysMemo.set(tree, out);
  return out;
}

/**
 * Collect the keys of the block mapping the cursor sits in, excluding
 * the pair the cursor is editing. The new editor's equivalent of the
 * legacy ``mapHasScalarKey`` filter — drives "don't re-suggest a key
 * that's already set in this mapping". Returns an empty set when the
 * cursor isn't inside a mapping (no filtering, matching prior
 * behaviour).
 */
export function collectSiblingKeys(state: EditorState, pos: number): Set<string> {
  const out = new Set<string>();
  const inner = syntaxTree(state).resolveInner(pos, -1);
  let map: SyntaxNode | null = inner;
  while (map && map.name !== "BlockMapping") map = map.parent;
  if (!map) return out;
  // The pair being edited stays out of the set so an in-place key edit
  // still completes itself — but only when its key sits on the cursor's
  // line. An empty ``key:`` opener absorbs the line below as its value, so
  // a new sibling typed beneath one would otherwise wrongly exclude that
  // key (and re-suggest it).
  const ownPair = findEnclosingPair(inner);
  const ownKey = ownPair?.getChild("Key");
  const ownKeyOnCursorLine =
    !!ownKey && state.doc.lineAt(ownKey.from).number === state.doc.lineAt(pos).number;
  for (const pair of mappingPairs(map)) {
    // Lezer nodes aren't reference-equal across traversals; a Pair is
    // uniquely identified by its start within one mapping.
    if (ownKeyOnCursorLine && pair.from === ownPair!.from) continue;
    const k = getPairKey(state, pair);
    if (k) out.add(k);
  }
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
  // Stream → Document → BlockMapping → Pair*
  const map = tree.topNode.getChild("Document")?.getChild("BlockMapping");
  const out = map ? uniqueMappingKeys(state, map) : [];
  topLevelKeysMemo.set(tree, out);
  return out;
}
