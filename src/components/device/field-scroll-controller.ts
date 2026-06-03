import type { PropertyValues } from "lit";
import { fieldKeyAttr, parseFieldKey } from "./config-entry-renderers-shared.js";

/** Renders to spend looking for a cursor-targeted field before giving up.
 *  entries + values land in separate renders, so one retry isn't enough;
 *  the cap stops an unbounded shadow-DOM walk for a never-rendered path. */
const MAX_TRIES = 3;

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
  private _tries = 0;

  constructor(private readonly host: FieldScrollHost) {}

  /** Call from the host's ``updated``: (re)attempt the scroll when the target
   *  or its surrounding data changed and it hasn't been reached yet. */
  maybeScroll(changed: PropertyValues): void {
    // A new cursor target hasn't been scrolled to yet; reset the retry budget.
    if (changed.has("focusFieldPath")) {
      this._scrolledKey = undefined;
      this._tries = 0;
    }
    const fp = this.host.focusFieldPath;
    if (
      fp?.length &&
      this._scrolledKey !== fieldKeyAttr(fp) &&
      this._tries < MAX_TRIES &&
      (changed.has("focusFieldPath") || changed.has("entries") || changed.has("values"))
    ) {
      this._tries++;
      void this._scrollTo(fp);
    }
  }

  private async _scrollTo(path: string[]): Promise<void> {
    const { host } = this;
    if (!host.shadowRoot) return;
    for (let i = 1; i < path.length; i++) {
      host.openNested(path.slice(0, i).join("."));
    }
    await host.updateComplete; // let any opened group render
    if (host.focusFieldPath !== path) return; // superseded by a newer move
    // Try the exact field, then progressively shorter prefixes: a
    // list-of-maps field (globals / filter items, whose form paths carry
    // a synthetic index the YAML path lacks) at least scrolls its
    // container into view.
    for (let len = path.length; len >= 1; len--) {
      const target = this._find(host.shadowRoot, path.slice(0, len));
      if (!target) continue;
      // ``center`` (not ``nearest``) so a tall field — long description
      // plus input — lands fully in view instead of clipped at the fold.
      target.scrollIntoView({ block: "center" });
      // Flash, but not for the same field twice within 10s — moving the
      // cursor around inside one field shouldn't keep re-pulsing it.
      const key = fieldKeyAttr(path.slice(0, len));
      const now = Date.now();
      if (key !== this._lastFlashKey || now - this._lastFlashAt > 10_000) {
        this._lastFlashKey = key;
        this._lastFlashAt = now;
        target.classList.remove("field--highlight");
        void target.offsetWidth;
        target.classList.add("field--highlight");
      }
      this._scrolledKey = fieldKeyAttr(path);
      return;
    }
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
