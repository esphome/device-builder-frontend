import { nothing } from "lit";
import { AsyncDirective } from "lit/async-directive.js";
import {
  type DirectiveParameters,
  type ElementPart,
  type PartInfo,
  PartType,
  directive,
} from "lit/directive.js";

/**
 * Window event the {@link tourAnchor} directive fires so the guided-tour
 * overlay can locate spotlight targets that live in unrelated components'
 * shadow roots — without ``document.querySelector`` (forbidden by CLAUDE.md)
 * or prop-drilling. Mirrors the ``esphome-show-ignored-changed`` window-event
 * pattern already used for cross-component UI flags.
 */
export const TOUR_ANCHOR_EVENT = "esphome-tour-anchor";

export interface TourAnchorEventDetail {
  /** Stable anchor id the tour steps reference (e.g. ``"validate"``). */
  id: string;
  /** The element to spotlight (always the directive's host element). */
  el: Element;
  action: "register" | "unregister";
}

function dispatchAnchor(
  id: string,
  el: Element,
  action: TourAnchorEventDetail["action"]
): void {
  window.dispatchEvent(
    new CustomEvent<TourAnchorEventDetail>(TOUR_ANCHOR_EVENT, {
      detail: { id, el, action },
    })
  );
}

/**
 * Element directive that registers its host element with the guided-tour
 * overlay under a stable ``id``. Place it on the real control a tour step
 * points at:
 *
 * ```ts
 * html`<button class="validate-button" ${tourAnchor("validate")}>…</button>`
 * ```
 *
 * Registration is event-driven (see {@link TOUR_ANCHOR_EVENT}) so the overlay
 * can measure targets across shadow boundaries and react to route changes:
 * the directive unregisters on ``disconnected`` (e.g. when the device editor
 * unmounts) and re-registers on ``reconnected``. Passing a falsy ``id`` makes
 * it a no-op, so callers can conditionally anchor without branching the
 * template.
 */
class TourAnchorDirective extends AsyncDirective {
  private _id?: string;
  private _el?: Element;

  constructor(partInfo: PartInfo) {
    super(partInfo);
    if (partInfo.type !== PartType.ELEMENT) {
      throw new Error("tourAnchor() can only be used as an element directive");
    }
  }

  // Never renders content; the directive only has side effects.
  render(_id?: string): typeof nothing {
    return nothing;
  }

  update(part: ElementPart, [id]: DirectiveParameters<this>): typeof nothing {
    const el = part.element;
    if (id === this._id && el === this._el) return nothing;
    if (this._id && this._el) dispatchAnchor(this._id, this._el, "unregister");
    this._id = id || undefined;
    this._el = el;
    if (this._id) dispatchAnchor(this._id, el, "register");
    return nothing;
  }

  protected disconnected(): void {
    if (this._id && this._el) dispatchAnchor(this._id, this._el, "unregister");
  }

  protected reconnected(): void {
    if (this._id && this._el) dispatchAnchor(this._id, this._el, "register");
  }
}

export const tourAnchor = directive(TourAnchorDirective);
