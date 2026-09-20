import type { ReactiveControllerHost } from "lit";
import type { ESPHomeAPI } from "../../api/index.js";
import type { ComponentCatalogIndexEntry } from "../../api/types/components.js";
import {
  type CatalogIndex,
  getCachedCatalogIndex,
  loadCatalog,
} from "../../util/yaml-completion-catalog.js";

/** How long a failed catalog index load waits before a render retries it. */
const RETRY_MS = 30_000;

/**
 * Hands a host the session's catalog index, loading it on first read and
 * re-rendering the host once it lands. A failed load re-renders nothing and
 * backs off, so a down backend isn't swept on every render.
 */
export class CatalogIndexController {
  /** No load before this time: held while one is in flight, pushed out after
   *  a failure. */
  private _retryAt = 0;

  constructor(
    private readonly _host: ReactiveControllerHost,
    private readonly _api: () => ESPHomeAPI | undefined
  ) {}

  byId(): ReadonlyMap<string, ComponentCatalogIndexEntry> | null {
    return this.index()?.byId ?? null;
  }

  index(): CatalogIndex | null {
    const index = getCachedCatalogIndex();
    const api = this._api();
    if (!index && api && Date.now() >= this._retryAt) {
      this._retryAt = Infinity;
      const backOff = () => {
        this._retryAt = Date.now() + RETRY_MS;
      };
      loadCatalog(api).then(() => {
        if (!getCachedCatalogIndex()) return backOff();
        // Reloads if the cache is ever cleared.
        this._retryAt = 0;
        this._host.requestUpdate();
      }, backOff);
    }
    return index;
  }
}
