import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { stripBase } from "../../util/base-path.js";
import { navigate } from "../../util/navigation.js";
import { TOUR_ANCHOR_EVENT, type TourAnchorEventDetail } from "./tour-anchor.js";
import { computeTourFrame, type TourFrame } from "./tour-geometry.js";
import { clearTourSuggestedName, setTourSuggestedName } from "./tour-session.js";
import {
  DIALOG_ANCHORS,
  STARTER_DEVICE_NAME,
  TOUR_STEPS,
  type TourStep,
} from "./tour-steps.js";

@customElement("esphome-guided-tour")
export class ESPHomeGuidedTour extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state() private _active = false;
  @state() private _stepIndex = 0;
  @state() private _frame: TourFrame | null = null;
  @state() private _skipHover = false;

  @query(".tour-popover") private _popover?: HTMLElement;
  @query(".btn-skip") private _skipButton?: HTMLElement;

  /** Live registry of anchor id → element, fed by ``TOUR_ANCHOR_EVENT``. */
  private readonly _anchors = new Map<string, Element>();

  private _clickTargets: Element[] = [];
  private _resizeObserver?: ResizeObserver;
  private _observedTarget: Element | null = null;

  private _observeTarget(el: Element | null): void {
    if (el === this._observedTarget) return;
    if (this._observedTarget) this._resizeObserver?.unobserve(this._observedTarget);
    this._observedTarget = el;
    if (el) this._resizeObserver?.observe(el);
  }

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: contents;
      }

      .tour-popover {
        position: fixed;
        inset: 0;
        width: auto;
        height: auto;
        max-width: 100vw;
        max-height: 100vh;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        overflow: visible;
        pointer-events: none;
      }

      .caret {
        position: absolute;
        width: 13px;
        height: 13px;
        background: var(--wa-color-surface-raised, #fff);
        transform: rotate(45deg);
        border-radius: 2px;
      }

      .bubble {
        position: absolute;
        background: var(--wa-color-surface-raised, #fff);
        color: var(--wa-color-text-normal);
        border-radius: var(--wa-border-radius-l);
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.32);
        padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-m);
        pointer-events: auto;
        box-sizing: border-box;
      }

      .step-label {
        font-size: 11px;
        font-weight: var(--wa-font-weight-bold);
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: var(--esphome-primary);
      }

      .bubble h2 {
        margin: var(--wa-space-2xs) 0 0;
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
      }

      .bubble p {
        margin: var(--wa-space-xs) 0 0;
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
      }

      .hint {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
        margin-top: var(--wa-space-m);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-semibold);
        color: var(--esphome-primary);
      }

      .hint-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--esphome-primary);
        animation: tour-pulse 1.4s infinite;
        flex-shrink: 0;
      }

      @keyframes tour-pulse {
        0%,
        100% {
          box-shadow: 0 0 0 0 color-mix(in srgb, var(--esphome-primary), transparent 55%);
        }
        50% {
          box-shadow: 0 0 0 7px
            color-mix(in srgb, var(--esphome-primary), transparent 100%);
        }
      }

      .actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: var(--wa-space-m);
      }

      .actions.action-only {
        justify-content: flex-start;
      }

      .btn {
        font-family: inherit;
        font-size: var(--wa-font-size-s);
        cursor: pointer;
        border: none;
        background: none;
        border-radius: var(--wa-border-radius-pill);
        pointer-events: auto;
      }

      .btn-skip {
        color: var(--wa-color-text-quiet);
        padding: var(--wa-space-2xs) 0;
      }

      .btn-skip:hover,
      .btn-skip.hovered {
        color: var(--wa-color-text-normal);
      }

      .btn-next {
        font-weight: var(--wa-font-weight-bold);
        color: var(--esphome-on-primary);
        background: var(--esphome-primary);
        padding: var(--wa-space-xs) var(--wa-space-l);
      }

      .btn-next:hover {
        background: var(--esphome-primary-hover);
      }

      @media (prefers-reduced-motion: reduce) {
        .hint-dot {
          animation: none;
        }
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener(TOUR_ANCHOR_EVENT, this._onAnchorEvent);
    window.addEventListener("resize", this._onReflow);
    window.addEventListener("scroll", this._onReflow, true);
    window.addEventListener("keydown", this._onKeydown, true);
    window.addEventListener("popstate", this._onPopState);
    window.addEventListener("wa-after-show", this._onDialogShown);
    window.addEventListener("click", this._onCaptureClick, true);
    window.addEventListener("pointermove", this._onWindowPointerMove);

    this._resizeObserver = new ResizeObserver(() => {
      if (this._active) this._refresh();
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener(TOUR_ANCHOR_EVENT, this._onAnchorEvent);
    window.removeEventListener("resize", this._onReflow);
    window.removeEventListener("scroll", this._onReflow, true);
    window.removeEventListener("keydown", this._onKeydown, true);
    window.removeEventListener("popstate", this._onPopState);
    window.removeEventListener("wa-after-show", this._onDialogShown);
    window.removeEventListener("click", this._onCaptureClick, true);
    window.removeEventListener("pointermove", this._onWindowPointerMove);
    this._setSkipCursor(false);
    this._teardownClicks();
    this._observeTarget(null);
    this._resizeObserver = undefined;
  }

  start(stepIndex = 0): void {
    setTourSuggestedName(STARTER_DEVICE_NAME);
    this._active = true;
    this._stepIndex = stepIndex;
    this._frame = null;
    if (this._step.route === "dashboard" && this._onDeviceRoute()) void navigate("/");
    this._scheduleMeasure();
  }

  protected firstUpdated(): void {
    this._consumeTourStepParam();
  }

  private _onPopState = (): void => {
    this._consumeTourStepParam();
  };

  private _onCaptureClick = (event: MouseEvent): void => {
    if (!this._active) return;
    if (!this._step.anchors.some((a) => DIALOG_ANCHORS.has(a))) return;
    const r = this._skipButton?.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) return;
    if (
      event.clientX >= r.left &&
      event.clientX <= r.right &&
      event.clientY >= r.top &&
      event.clientY <= r.bottom
    ) {
      event.preventDefault();
      event.stopPropagation();
      this._skip();
    }
  };

  private _onWindowPointerMove = (event: PointerEvent): void => {
    const onDialogStep =
      this._active && this._step.anchors.some((a) => DIALOG_ANCHORS.has(a));
    const r = onDialogStep ? this._skipButton?.getBoundingClientRect() : undefined;
    const over =
      !!r &&
      r.width > 0 &&
      event.clientX >= r.left &&
      event.clientX <= r.right &&
      event.clientY >= r.top &&
      event.clientY <= r.bottom;
    if (over === this._skipHover) return;
    this._skipHover = over;
    this._setSkipCursor(over);
  };

  private _setSkipCursor(on: boolean): void {
    document.documentElement.style.cursor = on ? "pointer" : "";
  }

  private _onDialogShown = (): void => {
    if (this._active && this._step.anchors.some((a) => DIALOG_ANCHORS.has(a))) {
      this._bouncePopover();
    }
  };

  private _consumeTourStepParam(): void {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("tourStep");
    if (raw === null) return;
    // Strip it regardless of validity so a stale value can't wedge in the URL.
    params.delete("tourStep");
    const query = params.toString();
    const cleaned =
      window.location.pathname + (query ? `?${query}` : "") + window.location.hash;
    window.history.replaceState(window.history.state, "", cleaned);
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= TOUR_STEPS.length) this.start(n - 1);
  }

  private get _step(): TourStep {
    return TOUR_STEPS[this._stepIndex];
  }

  private _onDeviceRoute(): boolean {
    return stripBase(window.location.pathname).startsWith("/device/");
  }

  private _onAnchorEvent = (event: Event): void => {
    const { id, el, action } = (event as CustomEvent<TourAnchorEventDetail>).detail;
    if (action === "register") {
      this._anchors.set(id, el);
    } else if (this._anchors.get(id) === el) {
      this._anchors.delete(id);
    }
    if (this._active && this._maybeAutoAdvance()) return;
    this._refresh();
  };

  private _maybeAutoAdvance(): boolean {
    if (this._step.kind !== "action") return false;
    const next = TOUR_STEPS[this._stepIndex + 1];
    if (!next) return false;
    const currentPresent = this._step.anchors.some((a) => this._anchors.has(a));
    const nextPresent = next.anchors.some((a) => this._anchors.has(a));
    if (!currentPresent && nextPresent) {
      this._goToStep(this._stepIndex + 1);
      return true;
    }
    return false;
  }

  private _onReflow = (): void => {
    if (this._active) this._refresh();
  };

  private _onKeydown = (event: KeyboardEvent): void => {
    if (!this._active) return;
    if (event.key === "Escape") {
      // Universal exit: skip the tour without also closing whatever modal sits
      // beneath (the user can press Escape again for that).
      event.preventDefault();
      event.stopPropagation();
      this._skip();
      return;
    }
    // Enter / → advance only the Next-button (info) steps; action steps own
    // the keyboard so typing in the wizard's name field isn't hijacked.
    if (
      this._step.kind === "info" &&
      (event.key === "Enter" || event.key === "ArrowRight")
    ) {
      event.preventDefault();
      this._next();
    }
  };

  private _presentAnchorEls(): Element[] {
    const els: Element[] = [];
    for (const id of this._step.anchors) {
      const el = this._anchors.get(id);
      if (el) els.push(el);
    }
    return els;
  }

  private _refresh(): void {
    if (!this._active) {
      this._teardownClicks();
      this._observeTarget(null);
      this._frame = null;
      return;
    }
    const present = this._presentAnchorEls();

    this._teardownClicks();
    if (this._step.kind === "action") {
      for (const el of present) {
        el.addEventListener("click", this._onAnchorClick);
        this._clickTargets.push(el);
      }
    }

    this._observeTarget(present[0] ?? null);

    const target =
      present.find((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 || r.height > 0;
      }) ?? null;
    if (!target) {
      if (this._frame !== null) this._frame = null;
      return;
    }

    const appearing = this._frame === null;
    const rect = target.getBoundingClientRect();
    this._frame = computeTourFrame(
      { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
      this._step.side,
      { w: window.innerWidth, h: window.innerHeight }
    );
    if (appearing && this._step.anchors.some((a) => DIALOG_ANCHORS.has(a))) {
      this._bouncePopover();
    }
  }

  private _onAnchorClick = (): void => {
    if (!this._active || this._step.kind !== "action") return;
    this._teardownClicks();
    this._goToStep(this._stepIndex + 1);
  };

  private _teardownClicks(): void {
    for (const el of this._clickTargets) {
      el.removeEventListener("click", this._onAnchorClick);
    }
    this._clickTargets = [];
  }

  private _goToStep(index: number): void {
    this._teardownClicks();
    this._stepIndex = index;
    this._frame = null;
    // The final dashboard steps follow the editor steps; pull back to the
    // dashboard ourselves (the create flow navigated us into the editor).
    if (this._step.route === "dashboard" && this._onDeviceRoute()) {
      void navigate("/");
    }
    this._scheduleMeasure();
  }

  private _next(): void {
    if (this._stepIndex >= TOUR_STEPS.length - 1) {
      this._finish();
      return;
    }
    this._goToStep(this._stepIndex + 1);
  }

  private _skip = (): void => {
    this._finish();
  };

  private _finish(): void {
    this._active = false;
    this._frame = null;
    this._skipHover = false;
    this._setSkipCursor(false);
    this._teardownClicks();
    this._observeTarget(null);
    clearTourSuggestedName();
    this._hidePopover();
    this.dispatchEvent(
      new CustomEvent("tour-finished", { bubbles: true, composed: true })
    );
  }

  /** Measure on the next frame, after navigation / dialog renders settle.
   *  In-dialog steps re-assert the popover above the modal first. */
  private _scheduleMeasure(): void {
    requestAnimationFrame(() => {
      if (!this._active) return;
      if (this._step.anchors.some((a) => DIALOG_ANCHORS.has(a))) {
        this._bouncePopover();
      } else {
        this._showPopover();
      }
      this._refresh();
    });
  }

  private _showPopover(): void {
    const el = this._popover;
    if (!el || !el.isConnected) return;
    if (!el.matches(":popover-open")) {
      try {
        el.showPopover();
      } catch {
        // Already shown / not yet upgraded — harmless.
      }
    }
  }

  private _hidePopover(): void {
    const el = this._popover;
    if (el?.matches(":popover-open")) el.hidePopover();
  }

  // Re-add to the top layer so the popover paints above a modal dialog opened
  // after it (top-layer order = show order).
  private _bouncePopover(): void {
    this._hidePopover();
    this._showPopover();
  }

  protected updated(): void {
    // Keep the popover's top-layer presence in sync with active state for the
    // page-level (non-dialog) steps; dialog steps bounce explicitly.
    if (this._active) {
      if (!this._step.anchors.some((a) => DIALOG_ANCHORS.has(a))) this._showPopover();
    } else {
      this._hidePopover();
    }
  }

  protected render() {
    // The popover element is always present so the query ref resolves; its
    // spotlight content renders only while a measured step is active.
    return html`<div class="tour-popover" popover="manual">
      ${this._active && this._frame ? this._renderSpotlight(this._frame) : nothing}
    </div>`;
  }

  private _caretStyle(frame: TourFrame, side: TourStep["side"]): Record<string, string> {
    const { hole, bubble } = frame;
    const OUT = "-6px";

    if (side === "left" || side === "right") {
      const pos = this._caretPos(hole.y, hole.h, bubble.top ?? 0);
      return side === "right" ? { left: OUT, top: pos } : { right: OUT, top: pos };
    }
    const pos = this._caretPos(hole.x, hole.w, bubble.left);
    return side === "top" ? { bottom: OUT, left: pos } : { top: OUT, left: pos };
  }

  private _caretPos(start: number, size: number, bubbleStart: number): string {
    const overlapStart = Math.max(0, start - bubbleStart);
    const overlapEnd = start + size - bubbleStart;
    return `clamp(12px, calc((${overlapStart}px + min(100%, ${overlapEnd}px)) / 2 - 6px), calc(100% - 20px))`;
  }

  private _renderSpotlight(frame: TourFrame) {
    const { bubble } = frame;
    const step = this._step;
    const bubbleStyle: Record<string, string> = {
      left: `${bubble.left}px`,
      width: `${bubble.width}px`,
      ...(bubble.bottom !== undefined
        ? { bottom: `${bubble.bottom}px` }
        : { top: `${bubble.top ?? 0}px` }),
    };
    return html`
      <div
        class="bubble"
        role="dialog"
        aria-live="polite"
        aria-label=${this._localize(step.titleKey)}
        style=${styleMap(bubbleStyle)}
      >
        <div
          class="caret"
          style=${styleMap(this._caretStyle(frame, frame.side))}
          aria-hidden="true"
        ></div>
        <div class="step-label">
          ${this._localize("tour.step_counter", {
            current: this._stepIndex + 1,
            total: TOUR_STEPS.length,
          })}
        </div>
        <h2>${this._localize(step.titleKey)}</h2>
        <p>${this._localize(step.bodyKey)}</p>
        ${step.kind === "action"
          ? html`
              <div class="hint">
                <span class="hint-dot" aria-hidden="true"></span>
                ${this._localize(step.hintKey ?? "tour.continue")}
              </div>
              <div class="actions action-only">
                <button
                  type="button"
                  class="btn btn-skip ${this._skipHover ? "hovered" : ""}"
                  @click=${this._skip}
                >
                  ${this._localize("tour.skip")}
                </button>
              </div>
            `
          : html`
              <div class="actions">
                <button type="button" class="btn btn-skip" @click=${this._skip}>
                  ${this._localize("tour.skip")}
                </button>
                <button type="button" class="btn btn-next" @click=${() => this._next()}>
                  ${this._stepIndex >= TOUR_STEPS.length - 1
                    ? this._localize("tour.finish")
                    : this._localize("tour.next")}
                </button>
              </div>
            `}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-guided-tour": ESPHomeGuidedTour;
  }
}
