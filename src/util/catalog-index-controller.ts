import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { ESPHomeAPI } from "../api/index.js";
import type { CatalogIndex } from "./yaml-completion-catalog.js";
import { loadCatalog } from "./yaml-completion-catalog.js";

/**
 * Reactive controller exposing the session-cached component catalog
 * index. `index` is null until the one-shot `loadCatalog` resolves
 * (empty index on failure — `loadCatalog` never rejects); the host
 * re-renders when it lands. The API is read through a getter so a
 * late-arriving context still kicks the load off (`hostUpdated`).
 */
export class CatalogIndexController implements ReactiveController {
  index: CatalogIndex | null = null;

  private _started = false;

  constructor(
    private readonly _host: ReactiveControllerHost,
    private readonly _getApi: () => ESPHomeAPI | undefined
  ) {
    _host.addController(this);
  }

  hostConnected(): void {
    this._kickoff();
  }

  hostUpdated(): void {
    this._kickoff();
  }

  private _kickoff(): void {
    if (this._started) return;
    const api = this._getApi();
    if (!api) return;
    this._started = true;
    void loadCatalog(api).then((index) => {
      this.index = index;
      this._host.requestUpdate();
    });
  }
}
