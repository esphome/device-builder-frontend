import { consume } from "@lit/context";
import { mdiClose } from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext, remoteComputeOnlyContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { isTypingTarget } from "../../util/typing-target.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { guidedTourStyles } from "./esphome-guided-tour.styles.js";
import { renderTourBubble, renderTourRecovery } from "./tour-bubble.js";
import { TOUR_LAYOUT_RESTORE_EVENT } from "./tour-layout-controller.js";
import { TourNavigatorController } from "./tour-navigator-controller.js";
import { captureTourConfiguration, navigateToTourStep } from "./tour-route.js";
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
import {
  clearTourConfiguration,
  clearTourPending,
  clearTourSuggestedName,
  getPendingTourStep,
  getTourConfiguration,
  setTourActive,
  setTourPending,
  setTourSuggestedName,
} from "./tour-session.js";
import { TourSkipAffordance } from "./tour-skip-affordance.js";
import { tourSpotlightStyles } from "./tour-spotlight.js";
import {
  DIALOG_ANCHORS,
  STARTER_DEVICE_NAME,
  TOUR_STEPS,
  type TourStep,
} from "./tour-steps.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ close: mdiClose });

@customElement("esphome-guided-tour")
export class ESPHomeGuidedTour extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: remoteComputeOnlyContext, subscribe: true })
  @state()
  private _remoteComputeOnly = false;

  @state() private _active = false;
  @state() private _stepIndex = 0;
  @state() private _frame: TourFrame | null = null;
  @state() private _showAnchorRecovery = false;

  @query(".tour-popover") private _popover?: HTMLElement;
  @query(".btn-skip") private _skipButton?: HTMLElement;
  @query(".btn-pause") private _pauseButton?: HTMLElement;

  private readonly _anchors = new Map<string, Element>();

  private _clickTargets: Element[] = [];
  private _resizeObserver?: ResizeObserver;
  private _observedTarget: Element | null = null;
  private _revealRequested = false;
  private _reflowScheduled = false;
  private _tourListenersBound = false;
  private _anchorRecoveryTimer?: number;
  private _dialogReady = false;

  private readonly _skipAffordance = new TourSkipAffordance(this, {
    isDialogStep: () =>
      this._active && this._step.anchors.some((a) => DIALOG_ANCHORS.has(a)),
    skipRect: () => this._skipButton?.getBoundingClientRect(),
    pauseRect: () => this._pauseButton?.getBoundingClientRect(),
    onSkip: () => this._skip(),
    onPause: () => this._pause(),
  });
  private readonly _navigator = new TourNavigatorController(this, {
    isNavigatorStep: () =>
      this._step.actionAnchors?.some((id) => id.endsWith("core-item")) ?? false,
    onCoreSelected: () => this._goToStep(this._stepIndex + 1),
    onReflow: () => this._refresh(),
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
    this._deactivate();
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
  }

  start(stepIndex = 0): void {
    if (this._remoteComputeOnly) {
      clearTourConfiguration();
      clearTourPending();
      return;
    }
    this._start(stepIndex, false);
  }

  private _start(requestedStep: number, resuming: boolean): void {
    let stepIndex =
      Number.isInteger(requestedStep) &&
      requestedStep >= 0 &&
      requestedStep < TOUR_STEPS.length
        ? requestedStep
        : 0;
    if (
      resuming &&
      TOUR_STEPS[stepIndex].anchors.some((anchor) => DIALOG_ANCHORS.has(anchor))
    ) {
      stepIndex = 0;
    }
    if (!resuming || stepIndex === 0) clearTourConfiguration();
    if (resuming && TOUR_STEPS[stepIndex].route === "device" && !getTourConfiguration()) {
      stepIndex = 0;
    }
    setTourPending(stepIndex);
    setTourSuggestedName(STARTER_DEVICE_NAME);
    this._active = true;
    setTourActive(true);
    this._stepIndex = stepIndex;
    this._frame = null;
    this._dialogReady = false;
    this._revealRequested = false;
    this._bindTourListeners();
    if (
      !navigateToTourStep(
        this._step,
        resuming,
        () => {
          if (this._active) this._scheduleMeasure();
        },
        () => {
          if (this._active) this._pause();
        }
      )
    ) {
      this._scheduleMeasure();
    }
  }

  private _bindTourListeners(): void {
    if (this._tourListenersBound) return;
    this._tourListenersBound = true;
    window.addEventListener("resize", this._onReflow);
    window.addEventListener("scroll", this._onReflow, true);
    window.addEventListener("keydown", this._onKeydown, true);
    window.addEventListener("wa-after-show", this._onDialogShown);
    this._navigator.setActive(true);
  }

  private _unbindTourListeners(): void {
    if (!this._tourListenersBound) return;
    this._tourListenersBound = false;
    window.removeEventListener("resize", this._onReflow);
    window.removeEventListener("scroll", this._onReflow, true);
    window.removeEventListener("keydown", this._onKeydown, true);
    window.removeEventListener("wa-after-show", this._onDialogShown);
    this._navigator.setActive(false);
  }

  protected firstUpdated(): void {
    this._consumeTourStepParam();
    const pendingStep = getPendingTourStep();
    if (!this._remoteComputeOnly && !this._active && pendingStep !== null) {
      this._start(pendingStep, true);
    }
  }

  private _onPopState = (): void => {
    this._consumeTourStepParam();
  };

  private _onDialogShown = (): void => {
    if (!this._active) return;
    this._dialogReady = true;
    if (this._maybeAutoAdvance()) return;
    if (this._step.anchors.some((a) => DIALOG_ANCHORS.has(a))) {
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

  private _onAnchorEvent = (event: Event): void => {
    const { id, el, action } = (event as CustomEvent<TourAnchorEventDetail>).detail;
    if (action === "register") {
      this._anchors.set(id, el);
    } else if (this._anchors.get(id) === el) {
      this._anchors.delete(id);
    }
    // Anchors register from all over the app; only react while touring.
    if (!this._active) return;
    captureTourConfiguration(this._active);
    if (action === "register" && this._step.anchors.includes(id)) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        requestAnimationFrame(() => {
          if (this._active && this._step.anchors.includes(id)) this._refresh();
        });
      }
    }
    if (action === "register" && id === "nav-mobile-core") {
      this._navigator.anchorRegistered(id, el);
    }
    if (this._maybeAutoAdvance()) return;
    this._refresh();
  };

  private _maybeAutoAdvance(): boolean {
    if (this._step.kind !== "action") return false;
    // Explicit action anchors must receive their click; visual-anchor churn
    // (for example opening the mobile navigator drawer) is not completion.
    if ((this._step.actionAnchors?.length ?? 0) > 0) return false;
    const next = TOUR_STEPS[this._stepIndex + 1];
    if (!next) return false;
    const currentPresent = this._step.anchors.some((a) => this._anchors.has(a));
    const nextPresent = next.anchors.some((a) => this._anchors.has(a));
    if (!currentPresent && nextPresent) {
      const enteringDialog =
        !this._step.anchors.some((anchor) => DIALOG_ANCHORS.has(anchor)) &&
        next.anchors.some((anchor) => DIALOG_ANCHORS.has(anchor));
      if (enteringDialog && !this._dialogReady) return false;
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
      this._pause();
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

  private _actionAnchorEls(): Element[] {
    const els: Element[] = [];
    for (const id of this._step.actionAnchors ?? this._step.anchors) {
      const el = this._anchors.get(id);
      if (el) els.push(el);
    }
    return els;
  }

  private _refresh(): void {
    if (!this._active) {
      this._clearAnchorRecovery();
      this._teardownClicks();
      this._observeTarget(null);
      this._frame = null;
      return;
    }
    const present = this._presentAnchorEls();

    this._teardownClicks();
    if (this._step.kind === "action") {
      for (const el of this._actionAnchorEls()) {
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
      this._scheduleAnchorRecovery();
      return;
    }

    this._clearAnchorRecovery();
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
    this._clearAnchorRecovery();
    // Consecutive dialog steps keep the affordance active; clear any hover
    // carried across so the cursor can't stay stuck until the next move.
    this._skipAffordance.reset();
    this._stepIndex = index;
    setTourPending(index);
    this._frame = null;
    this._revealRequested = false;
    if (
      !navigateToTourStep(
        this._step,
        false,
        () => {
          if (this._active) this._scheduleMeasure();
        },
        () => {
          if (this._active) this._pause();
        }
      )
    ) {
      this._scheduleMeasure();
    }
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

  private _pause = (): void => {
    this._deactivate();
    this.dispatchEvent(new CustomEvent("tour-paused", { bubbles: true, composed: true }));
  };

  private _deactivate(): void {
    this._clearAnchorRecovery();
    this._active = false;
    setTourActive(false);
    this._frame = null;
    this._unbindTourListeners();
    this._skipAffordance.reset();
    this._teardownClicks();
    this._observeTarget(null);
    clearTourSuggestedName();
    window.dispatchEvent(new Event(TOUR_LAYOUT_RESTORE_EVENT));
    this._hidePopover();
  }

  private _finish(): void {
    clearTourConfiguration();
    clearTourPending();
    this._deactivate();
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

  private _scheduleAnchorRecovery(): void {
    if (this._anchorRecoveryTimer !== undefined || this._showAnchorRecovery) return;
    this._anchorRecoveryTimer = window.setTimeout(() => {
      this._anchorRecoveryTimer = undefined;
      if (this._active && this._frame === null) this._showAnchorRecovery = true;
    }, 800);
  }

  private _clearAnchorRecovery(): void {
    if (this._anchorRecoveryTimer !== undefined) {
      clearTimeout(this._anchorRecoveryTimer);
      this._anchorRecoveryTimer = undefined;
    }
    this._showAnchorRecovery = false;
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
    if (this._remoteComputeOnly) {
      clearTourConfiguration();
      clearTourPending();
      if (this._active) this._deactivate();
      return;
    }
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
      ${
        this._active && this._frame
          ? renderTourBubble({
              frame: this._frame,
              step: this._step,
              stepIndex: this._stepIndex,
              totalSteps: TOUR_STEPS.length,
              localize: this._localize,
              skipHover: this._skipAffordance.hover,
              pauseHover: this._skipAffordance.pauseHover,
              onPause: this._pause,
              onSkip: this._skip,
              onNext: () => this._next(),
            })
          : this._active && this._showAnchorRecovery
            ? renderTourRecovery(this._localize, this._pause, this._skip)
            : nothing
      }
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-guided-tour": ESPHomeGuidedTour;
  }
}
