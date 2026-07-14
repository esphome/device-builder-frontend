import type { PropertyValues } from "lit";
import { fieldKeyAttr, parseFieldKey } from "./config-entry-renderers-shared.js";
import { flashHighlight } from "./field-highlight.js";

/** Renders to spend looking for a cursor-targeted field before giving up.
 *  entries + values land in separate renders, so one retry isn't enough;
 *  the cap stops an unbounded shadow-DOM walk for a never-rendered path. */
const MAX_TRIES = 3;

/** Don't re-pulse the same field within this window — moving the cursor
 *  around inside one field shouldn't keep re-flashing it. */
const FLASH_DEDUP_MS = 10_000;

/** Mutable gating state for the scroll retry, split out so the decision is
 *  unit-testable without a DOM. */
export interface ScrollGate {
  /** Key (``fieldKeyAttr``) of the target already scrolled to, or undefined. */
  scrolledKey?: string;
  /** Last target key seen; resets the budget on value change rather than on
   *  the fresh array reference ``focusFieldPath`` gets every cursor move. */
  lastFocusKey?: string;
  /** Scroll attempts spent on the current target. */
  tries: number;
}

/**
 * Advance the scroll gate for the current target *key* and decide whether to
 * (re)attempt the scroll. Resets the budget when the target changes by value;
 * attempts while unscrolled, within *maxTries*, and a relevant prop changed.
 * Pure — ``scrolledKey`` is only cleared here; a successful scroll sets it.
 */
export function advanceScrollGate(
  gate: ScrollGate,
  key: string | undefined,
  relevantChange: boolean,
  maxTries: number
): { gate: ScrollGate; scroll: boolean } {
  let { scrolledKey, lastFocusKey, tries } = gate;
  if (key !== lastFocusKey) {
    lastFocusKey = key;
    scrolledKey = undefined;
    tries = 0;
  }
  const scroll = !!key && scrolledKey !== key && tries < maxTries && relevantChange;
  if (scroll) tries++;
  return { gate: { scrolledKey, lastFocusKey, tries }, scroll };
}

/** Open keys for disclosures that gate *path* — a disclosure declares the
 *  path prefix it hides behind; a strict-ancestor prefix means it must open.
 *  An empty prefix gates nothing (a malformed decl mustn't match every path). */
export function gatingDisclosureKeys(
  decls: ReadonlyArray<{ prefix: string[]; key: string }>,
  path: string[]
): string[] {
  return decls
    .filter(
      (d) =>
        d.prefix.length > 0 &&
        d.prefix.length < path.length &&
        d.prefix.every((k, i) => k === path[i])
    )
    .map((d) => d.key);
}

/** The form surface this helper drives. */
export interface FieldScrollHost {
  shadowRoot: ShadowRoot | null;
  /** Instance-relative field path the YAML cursor is on, or empty. */
  focusFieldPath?: string[];
  /** Force a nested group open so a deep field renders before the search. */
  openNested(key: string): void;
  updateComplete: Promise<boolean>;
}

/**
 * Scrolls the YAML-cursor-selected field into view and flashes it, retrying
 * across the entries/values renders until the field exists (bounded) and
 * honoring an already-in-viewport line by not re-pulsing within 10s. Owned
 * by the form and driven from its ``updated`` via ``maybeScroll``.
 */
export class FieldScrollController {
  private _lastFlashKey?: string;
  private _lastFlashAt = 0;
  /** ``focusFieldPath`` already scrolled to; a later value edit doesn't
   *  re-scroll a consumed target. */
  private _scrolledKey?: string;
  /** Last target key seen — ``focusFieldPath`` is a fresh array on every
   *  cursor-line move, so the retry budget resets on value change, not
   *  reference change (else the same field re-scrolls on each move). */
  private _lastFocusKey?: string;
  private _tries = 0;

  constructor(private readonly host: FieldScrollHost) {}

  /** Call from the host's ``updated``: (re)attempt the scroll when the target
   *  or its surrounding data changed and it hasn't been reached yet. */
  maybeScroll(changed: PropertyValues): void {
    const fp = this.host.focusFieldPath;
    const key = fp?.length ? fieldKeyAttr(fp) : undefined;
    // showAdvanced counts: a focus-driven advanced reveal renders the
    // target field a pass after the path landed.
    const relevant =
      changed.has("focusFieldPath") ||
      changed.has("entries") ||
      changed.has("values") ||
      changed.has("showAdvanced");
    const { gate, scroll } = advanceScrollGate(
      {
        scrolledKey: this._scrolledKey,
        lastFocusKey: this._lastFocusKey,
        tries: this._tries,
      },
      key,
      relevant,
      MAX_TRIES
    );
    this._scrolledKey = gate.scrolledKey;
    this._lastFocusKey = gate.lastFocusKey;
    this._tries = gate.tries;
    if (scroll && fp?.length && key) void this._scrollTo(fp, key);
  }

  private async _scrollTo(path: string[], key: string): Promise<void> {
    const { host } = this;
    if (!host.shadowRoot) return;
    for (let i = 1; i < path.length; i++) {
      host.openNested(path.slice(0, i).join("."));
    }
    // Custom disclosures (e.g. pin Advanced) aren't dotted-path keyed; they
    // declare the prefix they hide behind in the DOM, so the controller stays
    // agnostic to any renderer's key convention.
    for (const k of gatingDisclosureKeys(this._gatingDecls(host.shadowRoot), path)) {
      host.openNested(k);
    }
    await host.updateComplete; // let any opened group render
    const cur = host.focusFieldPath;
    if (!cur || fieldKeyAttr(cur) !== key) return; // superseded by a newer move
    // Try the exact field, then progressively shorter prefixes: a
    // list-of-maps field (globals / filter items, whose form paths carry
    // a synthetic index the YAML path lacks) at least scrolls its
    // container into view. Only an exact match consumes the target; a
    // prefix-only match still scrolls but leaves the budget to refine to the
    // exact field once it renders (FLASH_DEDUP_MS guards against re-pulsing).
    for (let len = path.length; len >= 1; len--) {
      const target = this._find(host.shadowRoot, path.slice(0, len));
      if (!target) continue;
      // ``center`` (not ``nearest``) so a tall field — long description
      // plus input — lands fully in view instead of clipped at the fold.
      target.scrollIntoView({ block: "center" });
      // Keyed on the matched prefix; debounced so it isn't re-pulsed on every
      // cursor nudge.
      const matchedKey = fieldKeyAttr(path.slice(0, len));
      const now = Date.now();
      if (matchedKey !== this._lastFlashKey || now - this._lastFlashAt > FLASH_DEDUP_MS) {
        this._lastFlashKey = matchedKey;
        this._lastFlashAt = now;
        flashHighlight(target);
      }
      if (len === path.length) this._scrolledKey = key;
      return;
    }
  }

  /** Read the gating-disclosure declarations a renderer rendered into the DOM:
   *  ``data-reveal-for`` is the gated path prefix, ``data-field-key`` the open key.
   *  Only the host shadow root is scanned (where pin Advanced renders); a future
   *  disclosure nested inside a child element's shadow root would need the same
   *  recursion ``_find`` uses. */
  private _gatingDecls(root: ParentNode): { prefix: string[]; key: string }[] {
    const decls: { prefix: string[]; key: string }[] = [];
    for (const el of root.querySelectorAll<HTMLElement>("[data-reveal-for]")) {
      const key = el.getAttribute("data-field-key");
      if (key) {
        decls.push({
          prefix: parseFieldKey(el.getAttribute("data-reveal-for") ?? ""),
          key,
        });
      }
    }
    return decls;
  }

  /** Find the field with *path*, recursing into nested custom-element shadow
   *  roots (registry lists, etc.) since ``querySelectorAll`` stops at them. */
  private _find(root: ParentNode, path: string[]): HTMLElement | null {
    for (const el of root.querySelectorAll<HTMLElement>("[data-field-key]")) {
      const p = parseFieldKey(el.getAttribute("data-field-key") ?? "");
      if (p.length === path.length && p.every((k, i) => k === path[i])) return el;
    }
    // Only custom elements (hyphenated tag) carry a shadow root, so skip the
    // plain-element subtree and recurse just into those.
    for (const el of root.querySelectorAll<HTMLElement>("*")) {
      if (!el.localName.includes("-")) continue;
      const sr = (el as HTMLElement & { shadowRoot: ShadowRoot | null }).shadowRoot;
      const found = sr ? this._find(sr, path) : null;
      if (found) return found;
    }
    return null;
  }
}
