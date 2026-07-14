import type { ReactiveController, ReactiveControllerHost } from "lit";

export interface TourSkipAffordanceOptions {
  /** True while the current step is anchored inside a modal dialog. */
  isDialogStep: () => boolean;
  /** The Skip button's current viewport rect (undefined when not rendered). */
  skipRect: () => DOMRect | undefined;
  /** The Close-for-now button's viewport rect. */
  pauseRect: () => DOMRect | undefined;
  onSkip: () => void;
  onPause: () => void;
}

/**
 * Skip/close-button hit-testing for dialog-anchored tour steps.
 *
 * While a modal ``wa-dialog`` is open the tour popover paints above it but
 * is not hit-testable — the dialog owns the pointer — so the bubble's Skip
 * buttons receive neither real clicks nor ``:hover``. This controller
 * reproduces both from window-level events: a capturing click inside either
 * button rect invokes its action, and pointer moves drive hover state plus
 * the pointer cursor. The cursor must live on ``document.documentElement``
 * (no element the tour controls is under the pointer), so the mutation is
 * confined here with teardown on both ``hostDisconnected`` and ``reset``.
 */
export class TourSkipAffordance implements ReactiveController {
  private _hover: "skip" | "pause" | null = null;
  private _prevCursor: string | null = null;
  private _listening = false;

  constructor(
    private readonly _host: ReactiveControllerHost,
    private readonly _options: TourSkipAffordanceOptions
  ) {
    _host.addController(this);
  }

  /** True while the pointer is over the Skip button's rect. */
  get hover(): boolean {
    return this._hover === "skip";
  }

  get pauseHover(): boolean {
    return this._hover === "pause";
  }

  /**
   * Attach the window listeners only while a dialog-anchored step is
   * showing — pointermove fires constantly, so they shouldn't idle for
   * the host's lifetime. Deactivating also clears any lingering hover.
   */
  setActive(on: boolean): void {
    if (on === this._listening) return;
    this._listening = on;
    if (on) {
      window.addEventListener("click", this._onCaptureClick, true);
      window.addEventListener("pointermove", this._onPointerMove);
    } else {
      window.removeEventListener("click", this._onCaptureClick, true);
      window.removeEventListener("pointermove", this._onPointerMove);
      this.reset();
    }
  }

  hostDisconnected(): void {
    this.setActive(false);
  }

  /** Clear the hover state and restore the document cursor. */
  reset(): void {
    if (this._hover === null) return;
    this._hover = null;
    this._setCursor(false);
    this._host.requestUpdate();
  }

  private _onCaptureClick = (event: MouseEvent): void => {
    if (!this._options.isDialogStep()) return;
    const target = this._hit(event);
    if (target === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (target === "skip") this._options.onSkip();
    else this._options.onPause();
  };

  private _onPointerMove = (event: PointerEvent): void => {
    const target = this._options.isDialogStep() ? this._hit(event) : null;
    if (target === this._hover) return;
    this._hover = target;
    this._setCursor(target !== null);
    this._host.requestUpdate();
  };

  private _hit(event: MouseEvent): "skip" | "pause" | null {
    if (this._inside(event, this._options.skipRect())) return "skip";
    if (this._inside(event, this._options.pauseRect())) return "pause";
    return null;
  }

  private _inside(event: MouseEvent, r: DOMRect | undefined): boolean {
    return (
      !!r &&
      r.width > 0 &&
      r.height > 0 &&
      event.clientX >= r.left &&
      event.clientX <= r.right &&
      event.clientY >= r.top &&
      event.clientY <= r.bottom
    );
  }

  /** Swap in the pointer cursor, restoring whatever inline value was there. */
  private _setCursor(on: boolean): void {
    if (on) {
      if (this._prevCursor === null) {
        this._prevCursor = document.documentElement.style.cursor;
      }
      document.documentElement.style.cursor = "pointer";
    } else if (this._prevCursor !== null) {
      document.documentElement.style.cursor = this._prevCursor;
      this._prevCursor = null;
    }
  }
}
