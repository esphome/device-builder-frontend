import type { ReactiveController, ReactiveControllerHost } from "lit";

export const TOUR_LAYOUT_CHANGE_EVENT = "esphome-tour-layout-change";
export const TOUR_LAYOUT_RESTORE_EVENT = "esphome-tour-layout-restore";

export class TourLayoutController<T> implements ReactiveController {
  private _previous: T | null = null;

  constructor(
    host: ReactiveControllerHost,
    private readonly _getLayout: () => T,
    private readonly _setLayout: (layout: T) => void
  ) {
    host.addController(this);
  }

  hostConnected(): void {
    window.addEventListener(TOUR_LAYOUT_CHANGE_EVENT, this._onChange);
    window.addEventListener(TOUR_LAYOUT_RESTORE_EVENT, this._onRestore);
    window.addEventListener("layout-change", this._onUserChange);
  }

  hostDisconnected(): void {
    window.removeEventListener(TOUR_LAYOUT_CHANGE_EVENT, this._onChange);
    window.removeEventListener(TOUR_LAYOUT_RESTORE_EVENT, this._onRestore);
    window.removeEventListener("layout-change", this._onUserChange);
    this._previous = null;
  }

  private _onChange = (event: Event): void => {
    if (this._previous === null) this._previous = this._getLayout();
    this._setLayout((event as CustomEvent<T>).detail);
  };

  private _onRestore = (): void => {
    if (this._previous === null) return;
    this._setLayout(this._previous);
    this._previous = null;
  };

  private _onUserChange = (): void => {
    this._previous = null;
  };
}
