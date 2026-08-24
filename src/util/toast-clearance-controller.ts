import type { ReactiveController, ReactiveControllerHost } from "lit";

/** Root custom property read by the sonner override in apply-theme.ts. */
export const TOAST_CLEARANCE_PROPERTY = "--esphome-toast-clearance";

/**
 * Keeps bottom-right toasts clear of a page's bottom-right action buttons.
 *
 * Pages that anchor buttons in the corner toasts land in (the device
 * editor's Save/Install row, the secrets Save button) opt in by pointing
 * this at that element. It measures how far the element's top edge sits
 * above the viewport bottom and publishes it as
 * ``--esphome-toast-clearance`` on ``<html>``; custom properties inherit
 * into the sonner toaster's shadow root, where the override in
 * apply-theme.ts lifts the toaster above that line. The property is
 * removed on disconnect so every other page keeps sonner's default offset.
 *
 * The property is a single slot, so only one publisher is expected to be
 * mounted at a time (each opt-in page is its own route). Re-measures follow
 * the target's box (ResizeObserver) and the viewport (window resize); host
 * updates only re-resolve the target, which can render late behind a load
 * ladder. The host itself is not observed because page hosts are
 * ``display: contents`` and never report a box.
 */
export class ToastClearanceController implements ReactiveController {
  private _observer = new ResizeObserver(() => this._measure());
  private _observed: HTMLElement | null = null;
  private _published: string | null = null;

  constructor(
    host: ReactiveControllerHost,
    private readonly _target: () => HTMLElement | null | undefined
  ) {
    host.addController(this);
  }

  hostConnected(): void {
    window.addEventListener("resize", this._measure);
    // A cache()d host can reattach without a render; re-resolve here too.
    this.hostUpdated();
  }

  hostUpdated(): void {
    const target = this._target() ?? null;
    if (target !== this._observed) {
      if (this._observed) this._observer.unobserve(this._observed);
      this._observed = target;
      if (target) this._observer.observe(target);
    }
    // Always measure: ResizeObserver reports the target's box, not its
    // position, and siblings above can move the row without resizing it.
    this._measure();
  }

  hostDisconnected(): void {
    window.removeEventListener("resize", this._measure);
    this._observer.disconnect();
    this._observed = null;
    this._publish(null);
  }

  private _measure = (): void => {
    const target = this._observed;
    if (!target) {
      this._publish(null);
      return;
    }
    const rect = target.getBoundingClientRect();
    // A hidden target reports an all-zero rect, which would read as a
    // full-viewport clearance and push toasts off-screen.
    if (rect.width === 0 && rect.height === 0) {
      this._publish(null);
      return;
    }
    const clearance = Math.round(window.innerHeight - rect.top);
    this._publish(`${Math.max(0, clearance)}px`);
  };

  /** Skips the write when unchanged: a root property write restyles the whole document. */
  private _publish(value: string | null): void {
    const style = document.documentElement.style;
    if (
      value === this._published &&
      style.getPropertyValue(TOAST_CLEARANCE_PROPERTY) === (value ?? "")
    ) {
      return;
    }
    this._published = value;
    if (value === null) style.removeProperty(TOAST_CLEARANCE_PROPERTY);
    else style.setProperty(TOAST_CLEARANCE_PROPERTY, value);
  }
}
