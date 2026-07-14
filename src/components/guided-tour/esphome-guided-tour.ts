import { consume } from "@lit/context";
import { LitElement, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { stripBase } from "../../util/base-path.js";
import { navigate } from "../../util/navigation.js";
import { isTypingTarget } from "../../util/typing-target.js";
import { guidedTourStyles } from "./esphome-guided-tour.styles.js";
import {
  TOUR_ANCHOR_EVENT,
  requestTourReveal,
  type TourAnchorEventDetail,
} from "./tour-anchor.js";
import {
  computeTourFrame,
  unionRects,
  type Rect,
  type TourFrame,
} from "./tour-geometry.js";
import { clearTourSuggestedName, setTourSuggestedName } from "./tour-session.js";
import { TourSkipAffordance } from "./tour-skip-affordance.js";
import { renderTourSpotlightBackdrop, tourSpotlightStyles } from "./tour-spotlight.js";
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

  @query(".tour-popover") private _popover?: HTMLElement;
  @query(".btn-skip") private _skipButton?: HTMLElement;

  private readonly _anchors = new Map<string, Element>();

  private _clickTargets: Element[] = [];
  private _resizeObserver?: ResizeObserver;
  private _observedTarget: Element | null = null;
  private _revealRequested = false;
  private _reflowScheduled = false;
  private _tourListenersBound = false;

  private readonly _skipAffordance = new TourSkipAffordance(this, {
    isDialogStep: () =>
      this._active && this._step.anchors.some((a) => DIALOG_ANCHORS.has(a)),
    skipRect: () => this._skipButton?.getBoundingClientRect(),
    onSkip: () => this._skip(),
  });

  private _observeTarget(el: Element | null): void {
    if (el === this._observedTarget) return;
    if (this._observedTarget) this._resizeObserver?.unobserve(this._observedTarget);
    this._observedTarget = el;
    if (el) this._resizeObserver?.observe(el);
  }

  static styles = [espHomeStyles, tourSpotlightStyles, guidedTourStyles];

  connectedCallback(): void {
    super.connectedCallback();
    // Only anchor registration and the ?tourStep= deep link stay permanent;
    // the interaction listeners bind for the tour's lifetime in start().
    window.addEventListener(TOUR_ANCHOR_EVENT, this._onAnchorEvent);
    window.addEventListener("popstate", this._onPopState);

    this._resizeObserver = new ResizeObserver(() => {
      if (this._active) this._refresh();
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener(TOUR_ANCHOR_EVENT, this._onAnchorEvent);
    window.removeEventListener("popstate", this._onPopState);
    this._unbindTourListeners();
    this._teardownClicks();
    this._observeTarget(null);
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
  }

  start(stepIndex = 0): void {
    setTourSuggestedName(STARTER_DEVICE_NAME);
    this._active = true;
    this._stepIndex = stepIndex;
    this._frame = null;
    this._revealRequested = false;
    this._bindTourListeners();
    if (this._step.route === "dashboard" && this._onDeviceRoute()) void navigate("/");
    this._scheduleMeasure();
  }

  private _bindTourListeners(): void {
    if (this._tourListenersBound) return;
    this._tourListenersBound = true;
    window.addEventListener("resize", this._onReflow);
    window.addEventListener("scroll", this._onReflow, true);
    window.addEventListener("keydown", this._onKeydown, true);
    window.addEventListener("wa-after-show", this._onDialogShown);
  }

  private _unbindTourListeners(): void {
    if (!this._tourListenersBound) return;
    this._tourListenersBound = false;
    window.removeEventListener("resize", this._onReflow);
    window.removeEventListener("scroll", this._onReflow, true);
    window.removeEventListener("keydown", this._onKeydown, true);
    window.removeEventListener("wa-after-show", this._onDialogShown);
  }

  protected firstUpdated(): void {
    this._consumeTourStepParam();
  }

  private _onPopState = (): void => {
    this._consumeTourStepParam();
  };

  private _onDialogShown = (): void => {
    if (this._active && this._step.anchors.some((a) => DIALOG_ANCHORS.has(a))) {
      // The dialog's open animation is a transform (no layout-box change), so
      // the target ResizeObserver never fires; re-measure now that it settled.
      this._refresh();
      this._bouncePopover();
    }
  };

  private _consumeTourStepParam(): void {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("tourStep");

    if (raw === null) return;

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
    // Anchors register from all over the app; only react while touring.
    if (!this._active) return;
    if (this._maybeAutoAdvance()) return;
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

  // Scroll/resize can fire many times per frame; coalesce the layout reads
  // in _refresh to one per animation frame.
  private _onReflow = (): void => {
    if (!this._active || this._reflowScheduled) return;
    this._reflowScheduled = true;
    requestAnimationFrame(() => {
      this._reflowScheduled = false;
      if (this._active) this._refresh();
    });
  };

  private _onKeydown = (event: KeyboardEvent): void => {
    if (!this._active) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this._skip();
      return;
    }

    if (this._step.kind !== "info") return;
    if (event.key !== "Enter" && event.key !== "ArrowRight") return;
    if (event.isComposing) return;
    // Don't steal keys from a focused control; composedPath()[0] is the real
    // focused element across shadow roots. Buttons/links keep Enter for
    // native activation.
    const el = event.composedPath()[0] as HTMLElement | undefined;
    if (isTypingTarget(el)) return;
    if (el && (el.tagName === "BUTTON" || el.tagName === "A")) return;
    event.preventDefault();
    this._next();
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

    const target =
      present.find((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 || r.height > 0;
      }) ?? null;
    // Observe the element we actually measure; fall back to the first
    // registered anchor so a reveal-driven resize (0×0 → sized) still fires.
    this._observeTarget(target ?? present[0] ?? null);
    if (!target) {
      // Anchors registered but zero-sized: the pane is hidden by the current
      // layout (single-pane mobile, YAML-only desktop). Ask the owner to
      // reveal it once — the ResizeObserver picks up the resulting resize.
      if (present.length > 0 && !this._revealRequested) {
        this._revealRequested = true;
        const presentId = this._step.anchors.find((a) => this._anchors.has(a));
        if (presentId) requestTourReveal(presentId);
      }
      if (this._frame !== null) this._frame = null;
      return;
    }

    const appearing = this._frame === null;
    // On first paint of a step, pull an off-screen target into view — the dim
    // backdrop swallows scroll, so a target below the fold (or its bubble)
    // would otherwise be unreachable on a small screen.
    if (appearing) this._scrollTargetIntoView(target);
    const tr = target.getBoundingClientRect();
    const rect = unionRects([
      { x: tr.left, y: tr.top, w: tr.width, h: tr.height },
      ...this._highlightRects(),
    ]);
    this._frame = computeTourFrame(rect, this._step.side, {
      w: window.innerWidth,
      h: window.innerHeight,
    });
    if (appearing && this._step.anchors.some((a) => DIALOG_ANCHORS.has(a))) {
      this._bouncePopover();
    }
  }

  /** Viewport rects of the step's sized highlight-only anchors. */
  private _highlightRects(): Rect[] {
    const rects: Rect[] = [];
    for (const id of this._step.highlightAnchors ?? []) {
      const el = this._anchors.get(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) {
        rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
    }
    return rects;
  }

  /** Center the target if it isn't already comfortably within the viewport. */
  private _scrollTargetIntoView(target: Element): void {
    if (typeof target.scrollIntoView !== "function") return;
    const r = target.getBoundingClientRect();
    const margin = 24;
    const visible = r.top >= margin && r.bottom <= window.innerHeight - margin;
    if (!visible) target.scrollIntoView({ block: "center", inline: "nearest" });
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
    // Consecutive dialog steps keep the affordance active; clear any hover
    // carried across so the cursor can't stay stuck until the next move.
    this._skipAffordance.reset();
    this._stepIndex = index;
    this._frame = null;
    this._revealRequested = false;
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
    this._unbindTourListeners();
    this._skipAffordance.reset();
    this._teardownClicks();
    this._observeTarget(null);
    clearTourSuggestedName();
    this._hidePopover();
    this.dispatchEvent(
      new CustomEvent("tour-finished", { bubbles: true, composed: true })
    );
  }

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
    if (!el || !el.isConnected || typeof el.showPopover !== "function") return;
    if (!el.matches(":popover-open")) el.showPopover();
  }

  private _hidePopover(): void {
    const el = this._popover;
    if (!el || typeof el.hidePopover !== "function") return;
    if (el.matches(":popover-open")) el.hidePopover();
  }

  private _bouncePopover(): void {
    this._hidePopover();
    this._showPopover();
  }

  protected updated(): void {
    const onDialogStep =
      this._active && this._step.anchors.some((a) => DIALOG_ANCHORS.has(a));
    this._skipAffordance.setActive(onDialogStep);
    if (this._active) {
      if (!onDialogStep) this._showPopover();
    } else {
      this._hidePopover();
    }
  }

  protected render() {
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
      ${renderTourSpotlightBackdrop(frame)}
      <div
        class="bubble"
        role="dialog"
        aria-live="polite"
        aria-label=${this._localize(step.titleKey)}
        style=${styleMap(bubbleStyle)}
      >
        ${
          frame.overlay
            ? nothing
            : html`<div
                class="caret"
                style=${styleMap(this._caretStyle(frame, frame.side))}
                aria-hidden="true"
              ></div>`
        }
        <div class="step-label">
          ${this._localize("tour.step_counter", {
            current: this._stepIndex + 1,
            total: TOUR_STEPS.length,
          })}
        </div>
        <h2>${this._localize(step.titleKey)}</h2>
        <p>${this._localize(step.bodyKey)}</p>
        ${
          step.kind === "action"
            ? html`
                <div class="hint">
                  <span class="hint-dot" aria-hidden="true"></span>
                  ${this._localize(step.hintKey ?? "tour.continue")}
                </div>
                <div class="actions action-only">
                  <button
                    type="button"
                    class="btn btn-skip ${this._skipAffordance.hover ? "hovered" : ""}"
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
                    ${
                      this._stepIndex >= TOUR_STEPS.length - 1
                        ? this._localize("tour.finish")
                        : this._localize("tour.next")
                    }
                  </button>
                </div>
              `
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-guided-tour": ESPHomeGuidedTour;
  }
}
