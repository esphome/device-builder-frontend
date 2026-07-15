import type { ReactiveController, ReactiveControllerHost } from "lit";
import { TOUR_ACTIVE_CHANGE_EVENT } from "./tour-session.js";

export class TourActivityController implements ReactiveController {
  constructor(private readonly _host: ReactiveControllerHost) {
    _host.addController(this);
  }

  hostConnected(): void {
    window.addEventListener(TOUR_ACTIVE_CHANGE_EVENT, this._onChange);
  }

  hostDisconnected(): void {
    window.removeEventListener(TOUR_ACTIVE_CHANGE_EVENT, this._onChange);
  }

  private _onChange = (): void => {
    this._host.requestUpdate();
  };
}
