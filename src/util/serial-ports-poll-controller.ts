import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { ESPHomeAPI } from "../api/index.js";
import type { SerialPort } from "../api/types/system.js";

export const SERIAL_PORTS_POLL_INTERVAL_MS = 5000;

export interface SerialPortsPollControllerOptions {
  /** Called when the first fetch of an active cycle fails. Later
   *  poll failures are swallowed, keeping the last good list. */
  onInitialError?: (err: unknown) => void;
}

/**
 * Reactive controller that polls ``config/serial_ports`` while a
 * port-picker surface is visible. Hosts call ``set(visible)`` from
 * ``willUpdate``; the controller fetches immediately, re-fetches every
 * ``SERIAL_PORTS_POLL_INTERVAL_MS``, and flags ports that appear after
 * the first fetch in ``newPorts`` so the UI can highlight a
 * just-plugged-in device. The host re-renders only when the list
 * actually changes.
 */
export class SerialPortsPollController implements ReactiveController {
  ports: SerialPort[] = [];
  loading = false;
  newPorts: ReadonlySet<string> = new Set();

  private _active = false;
  private _cycle = 0;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _inFlightCycle: number | null = null;
  /** Port paths from the previous fetch; ``null`` until the first
   *  successful fetch of a cycle seeds the new-port baseline. */
  private _seen: Set<string> | null = null;

  constructor(
    private readonly _host: ReactiveControllerHost,
    private readonly _getApi: () => ESPHomeAPI,
    private readonly _options: SerialPortsPollControllerOptions = {}
  ) {
    _host.addController(this);
  }

  hostDisconnected() {
    this.set(false);
  }

  set(active: boolean) {
    if (active === this._active) return;
    this._active = active;
    this._cycle++;
    if (active) {
      this.ports = [];
      this.newPorts = new Set();
      this._seen = null;
      this.loading = true;
      void this._poll();
      this._timer = setInterval(() => void this._poll(), SERIAL_PORTS_POLL_INTERVAL_MS);
    } else {
      if (this._timer !== null) {
        clearInterval(this._timer);
        this._timer = null;
      }
      this.loading = false;
    }
  }

  private async _poll() {
    const cycle = this._cycle;
    if (this._inFlightCycle === cycle) return;
    this._inFlightCycle = cycle;
    try {
      const ports = await this._getApi().getSerialPorts();
      if (cycle !== this._cycle) return;
      this._apply(ports);
    } catch (err) {
      if (cycle !== this._cycle || !this.loading) return;
      // First fetch of the cycle failed. ``_seen`` stays null so the
      // next successful poll seeds the baseline instead of flagging
      // every port as new.
      this.loading = false;
      this._options.onInitialError?.(err);
      this._host.requestUpdate();
    } finally {
      if (this._inFlightCycle === cycle) this._inFlightCycle = null;
    }
  }

  private _apply(ports: SerialPort[]) {
    const paths = new Set(ports.map((p) => p.port));
    // A port absent from the previous fetch is new, and stays flagged
    // while present; pruning unplugged ports lets a replug re-flag.
    const fresh = new Set(
      this._seen === null
        ? []
        : [...paths].filter((path) => this.newPorts.has(path) || !this._seen!.has(path))
    );
    const changed =
      this.loading ||
      ports.length !== this.ports.length ||
      ports.some(
        (p, i) => p.port !== this.ports[i].port || p.desc !== this.ports[i].desc
      ) ||
      fresh.size !== this.newPorts.size ||
      [...fresh].some((path) => !this.newPorts.has(path));

    this._seen = paths;
    if (!changed) return;
    this.ports = ports;
    this.newPorts = fresh;
    this.loading = false;
    this._host.requestUpdate();
  }
}
