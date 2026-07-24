import { reacquirePort } from "../../util/web-serial.js";

/**
 * Keeps a card's authorized SerialPort across the spurious disconnect that
 * native-USB chips fire when they re-enumerate right after being authorized
 * (#1410: the device card vanished before "Prepare device" could be clicked).
 *
 * On a disconnect event it reacquires a live handle for the same device and
 * reports it via onReplace, moving the watch to the new handle; only when the
 * device stays gone past the re-enumeration window does it report onGone (a
 * genuine unplug).
 */
export class PortDisconnectWatcher {
  private _port?: SerialPort;
  private _generation = 0;

  constructor(
    private readonly _onReplace: (port: SerialPort) => void,
    private readonly _onGone: () => void
  ) {}

  /** Watch a newly-authorized port, replacing any previous watch. */
  watch(port: SerialPort): void {
    this.unwatch();
    this._port = port;
    port.addEventListener("disconnect", this._handleDisconnect);
  }

  /** Stop watching (explicit disconnect / unmount); no callbacks fire after. */
  unwatch(): void {
    this._generation++;
    this._port?.removeEventListener("disconnect", this._handleDisconnect);
    this._port = undefined;
  }

  private _handleDisconnect = (): void => {
    const port = this._port;
    if (!port) return;
    // A later disconnect (or unwatch) supersedes this reacquire attempt.
    const generation = ++this._generation;
    void reacquirePort(port).then((live) => {
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
    });
  };
}
