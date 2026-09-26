import type { ReactiveController, ReactiveControllerHost } from "lit";
import { type BleUnavailableReason, bleUnavailableReason } from "./ble-nus-stream.js";

/** ``pending`` until the adapter answers, then usable or the reason it is not. */
export type BleProbeState = "pending" | "available" | BleUnavailableReason;

/**
 * Reactive controller that asks whether Bluetooth can be used while a
 * surface offering it is visible. Hosts call ``set(visible)`` from
 * ``willUpdate``; each time the surface becomes visible a fresh probe
 * runs (the radio may have been switched on meanwhile), and only the
 * newest probe's answer lands in ``state``. A control gated on it stays
 * non-actionable while ``pending``, so a slow answer cannot let a click
 * through to a chooser that then fails.
 */
export class BleProbeController implements ReactiveController {
  state: BleProbeState = "pending";

  private _active = false;
  private _gen = 0;

  constructor(private readonly _host: ReactiveControllerHost) {
    _host.addController(this);
  }

  hostDisconnected(): void {
    this.set(false);
  }

  set(active: boolean): void {
    if (active === this._active) return;
    this._active = active;
    const gen = ++this._gen;
    // The last answer stays on screen while hidden; only an open re-asks.
    if (!active) return;
    this.state = "pending";
    void bleUnavailableReason().then((reason) => {
      if (gen !== this._gen) return;
      this.state = reason ?? "available";
      this._host.requestUpdate();
    });
  }
}
