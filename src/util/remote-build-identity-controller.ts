import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { IdentityView } from "../api/types/remote-build.js";

/**
 * Loads this dashboard's remote-build identity and keeps it fresh.
 *
 * Loads on host connect, retrying on later updates while the api context is
 * still unresolved so the loading row can't strand. Hosts consuming
 * ``buildServerIdentityRotationCounterContext`` forward counter bumps through
 * :meth:`onRotationCounterChanged` so a rotate in another tab refreshes the
 * local card. A host that rotates in-place can push the returned view via
 * :meth:`set`.
 */
export class RemoteBuildIdentityController implements ReactiveController {
  identity: IdentityView | null = null;
  loadFailed = false;

  private _inFlight = false;

  constructor(
    private readonly _host: ReactiveControllerHost,
    private readonly _getApi: () => ESPHomeAPI | undefined
  ) {
    _host.addController(this);
  }

  hostConnected(): void {
    void this.load();
  }

  hostUpdated(): void {
    // The api context can land a tick after hostConnected; pick it up.
    if (this.identity !== null || this.loadFailed || this._inFlight) return;
    if (this._getApi() === undefined) return;
    void this.load();
  }

  async load(): Promise<void> {
    const api = this._getApi();
    if (api === undefined || this._inFlight) return;
    this._inFlight = true;
    try {
      this.identity = await api.getRemoteBuildIdentity();
      this.loadFailed = false;
    } catch (err) {
      console.warn("Could not load remote-build identity:", err);
      this.loadFailed = true;
    } finally {
      this._inFlight = false;
    }
    this._host.requestUpdate();
  }

  onRotationCounterChanged(): void {
    void this.load();
  }

  set(identity: IdentityView): void {
    this.identity = identity;
    this.loadFailed = false;
    this._host.requestUpdate();
  }
}
