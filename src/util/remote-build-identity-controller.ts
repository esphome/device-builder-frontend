import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { IdentityView } from "../api/types/remote-build.js";

/**
 * Loads this dashboard's remote-build identity and keeps it fresh.
 *
 * Loads on host connect; hosts consuming
 * ``buildServerIdentityRotationCounterContext`` forward counter bumps through
 * :meth:`onRotationCounterChanged` so a rotate in another tab refreshes the
 * local card. A host that rotates in-place can push the returned view via
 * :meth:`set`.
 */
export class RemoteBuildIdentityController implements ReactiveController {
  identity: IdentityView | null = null;
  loadFailed = false;

  constructor(
    private readonly _host: ReactiveControllerHost,
    private readonly _getApi: () => ESPHomeAPI | undefined
  ) {
    _host.addController(this);
  }

  hostConnected(): void {
    void this.load();
  }

  async load(): Promise<void> {
    const api = this._getApi();
    if (api === undefined) return;
    try {
      this.identity = await api.getRemoteBuildIdentity();
      this.loadFailed = false;
    } catch (err) {
      console.warn("Could not load remote-build identity:", err);
      this.loadFailed = true;
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
