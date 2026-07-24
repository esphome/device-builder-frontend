import type { ReactiveController, ReactiveControllerHost } from "lit";

import { reacquirePort } from "../../util/web-serial.js";

/**
 * Keeps a card's authorized SerialPort across the spurious disconnect that
 * native-USB chips fire when they re-enumerate right after being authorized
 * (#1410: the device card vanished before "Prepare device" could be clicked).
 *
 * On a disconnect event it reacquires a live handle for the same device and
 * reports it via onReplace, moving the watch to the new handle; only when the
 * device stays gone past the re-enumeration window does it report onGone (a
 * genuine unplug). Host disconnect cancels a pending reacquire and detaches
 * the listener; reconnect re-attaches it to the held port.
 */
export class PortDisconnectWatcher implements ReactiveController {
  private _port?: SerialPort;
  private _generation = 0;

  constructor(
    host: ReactiveControllerHost,
    private readonly _onReplace: (port: SerialPort) => void,
    private readonly _onGone: () => void
  ) {
    host.addController(this);
  }

  /** Watch a newly-authorized port, replacing any previous watch. */
  watch(port: SerialPort): void {
    this.unwatch();
    this._port = port;
    port.addEventListener("disconnect", this._handleDisconnect);
  }

  /** Fold in a live handle another recovery path produced (the logs
   *  dialog's read-error resume): report it and move the watch — which
   *  also supersedes any reacquire in flight for the same physical
   *  disconnect. */
  adopt(port: SerialPort): void {
    this.watch(port);
    this._onReplace(port);
  }

  /** Stop watching (explicit disconnect); no callbacks fire after. */
  unwatch(): void {
    this._generation++;
    this._port?.removeEventListener("disconnect", this._handleDisconnect);
    this._port = undefined;
  }

  hostConnected(): void {
    this._port?.addEventListener("disconnect", this._handleDisconnect);
  }

  hostDisconnected(): void {
    this._generation++;
    this._port?.removeEventListener("disconnect", this._handleDisconnect);
  }

  private _handleDisconnect = (): void => {
    const port = this._port;
    if (!port) return;
    // A later disconnect, watch, or unwatch supersedes this reacquire attempt
    // (and cancels its polling).
    const generation = ++this._generation;
    void reacquirePort(port, { cancelled: () => generation !== this._generation }).then(
      (live) => {
        if (generation !== this._generation) return;
        if (!live) {
          this.unwatch();
          this._onGone();
          return;
        }
        if (live !== port) {
          port.removeEventListener("disconnect", this._handleDisconnect);
          this._port = live;
          live.addEventListener("disconnect", this._handleDisconnect);
        }
        this._onReplace(live);
      }
    );
  };
}
