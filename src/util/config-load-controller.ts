import type { ReactiveController, ReactiveControllerHost } from "lit";
import { APIError } from "../api/api-error.js";
import type { ESPHomeAPI } from "../api/index.js";
import { loadConfigWithRecovery } from "./load-with-recovery.js";

export type ConfigLoadState = "loading" | "ready" | "error" | "missing";

export interface ConfigLoadOptions {
  api: () => ESPHomeAPI;
  /** WS liveness; the false→true edge re-runs a load that gave up. */
  connected: () => boolean;
  configuration: () => string;
  /** Transport attempts before the failure surfaces; spent only while
   *  the socket is up (``loadConfigWithRecovery`` parks otherwise). */
  attempts: number;
  timeoutMs?: number;
  /** Write the loaded YAML into the host's buffers. */
  commit: (yaml: string) => void;
  /** Runs after a successful load, outside the failure path. */
  onReady?: () => void;
  /** Terminal server reply: ``{seed}`` commits substitute content as
   *  success, ``"missing"`` parks terminally, undefined errors. */
  onApiError?: (err: APIError) => { seed: string } | "missing" | undefined;
  /** A failure over a ready buffer; the content stays rendered. */
  onRefreshFailed?: () => void;
}

/**
 * Owns a page's YAML-load ladder: supersession, transport retries, and
 * the reconnect re-run.
 */
export class ConfigLoadController implements ReactiveController {
  state: ConfigLoadState = "loading";

  retry = () => void this.start();

  private _gen = 0;
  private _active = false;
  private _prevConnected = false;

  constructor(
    private readonly _host: ReactiveControllerHost,
    private readonly _opts: ConfigLoadOptions
  ) {
    _host.addController(this);
  }

  hostConnected(): void {
    this._active = true;
  }

  hostDisconnected(): void {
    this._active = false;
  }

  hostUpdated(): void {
    const connected = this._opts.connected();
    // Socket is back: a load that gave up while it was down goes again
    // without the user hunting for the Retry button. "missing" is a
    // server answer, so it stays put.
    if (connected && !this._prevConnected && this.state === "error") {
      void this.start();
    }
    this._prevConnected = connected;
  }

  /** Foreground load: the ladder replaces the content until it settles. */
  start(): Promise<void> {
    return this._load(false);
  }

  /** Background reload: a ready buffer stays rendered; a failure over it
   *  surfaces through ``onRefreshFailed`` instead of the error panel. */
  refresh(): Promise<void> {
    return this._load(true);
  }

  private async _load(background: boolean): Promise<void> {
    const configuration = this._opts.configuration();
    const gen = ++this._gen;
    if (!background || this.state !== "ready") this._setState("loading");
    let yaml: string | null;
    try {
      yaml = await loadConfigWithRecovery(this._opts.api(), configuration, {
        // Unmount and a changed target count as abandoned too, or a slow
        // load keeps fetching against a page that has moved on.
        abandoned: () =>
          !this._active ||
          this._opts.configuration() !== configuration ||
          gen !== this._gen,
        attempts: this._opts.attempts,
        timeoutMs: this._opts.timeoutMs,
      });
    } catch (err) {
      const handled = err instanceof APIError ? this._opts.onApiError?.(err) : undefined;
      if (handled === "missing") {
        this._setState("missing");
        return;
      }
      if (handled === undefined) {
        console.error(`Failed to load ${configuration}:`, err);
        if (this.state === "ready") this._opts.onRefreshFailed?.();
        else this._setState("error");
        return;
      }
      yaml = handled.seed;
    }
    // Null means the page moved on; leave the buffers to the newer load.
    if (yaml === null) return;
    this._opts.commit(yaml);
    this._setState("ready");
    this._opts.onReady?.();
  }

  private _setState(state: ConfigLoadState): void {
    if (this.state === state) return;
    this.state = state;
    this._host.requestUpdate();
  }
}
