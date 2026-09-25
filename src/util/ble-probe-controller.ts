import type { ReactiveController, ReactiveControllerHost } from "lit";
import { type BleUnavailableReason, bleUnavailableReason } from "./ble-nus-stream.js";

/**
 * Reactive controller that asks whether Bluetooth can be used while a
 * surface offering it is visible. Hosts call ``set(visible)`` from
 * ``willUpdate``; each time the surface becomes visible a fresh probe
 * runs (the radio may have been switched on meanwhile), and only the
 * newest probe's answer lands in ``reason``. ``null`` means usable, or
 * not yet known, so the host's control starts enabled.
 */
export class BleProbeController implements ReactiveController {
  reason: BleUnavailableReason | null = null;

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
    this.reason = null;
    const gen = ++this._gen;
    if (!active) return;
    void bleUnavailableReason().then((reason) => {
      if (gen !== this._gen) return;
      this.reason = reason;
      this._host.requestUpdate();
    });
  }
}
