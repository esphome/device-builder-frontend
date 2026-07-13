import { nothing } from "lit";
import { AsyncDirective } from "lit/async-directive.js";
import {
  type DirectiveParameters,
  type ElementPart,
  type PartInfo,
  PartType,
  directive,
} from "lit/directive.js";

export const TOUR_ANCHOR_EVENT = "esphome-tour-anchor";
export const TOUR_REVEAL_EVENT = "esphome-tour-reveal";

export interface TourAnchorEventDetail {
  id: string;
  el: Element;
  action: "register" | "unregister";
}

export interface TourRevealEventDetail {
  id: string;
}

/**
 * Ask the component owning *id* to make that anchor visible (e.g. a pane
 * hidden by the current editor layout). Fired by the tour when a step's
 * anchor is registered but has no size; owners may ignore it.
 */
export function requestTourReveal(id: string): void {
  window.dispatchEvent(
    new CustomEvent<TourRevealEventDetail>(TOUR_REVEAL_EVENT, { detail: { id } })
  );
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

class TourAnchorDirective extends AsyncDirective {
  private _id?: string;
  private _el?: Element;

  constructor(partInfo: PartInfo) {
    super(partInfo);
    if (partInfo.type !== PartType.ELEMENT) {
      throw new Error("tourAnchor() can only be used as an element directive");
    }
  }

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
