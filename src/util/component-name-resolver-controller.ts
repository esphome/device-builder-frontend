import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { ESPHomeAPI } from "../api/index.js";
import {
  fetchComponent,
  getCachedComponent,
  subscribeComponentCache,
} from "./component-name-cache.js";

/**
 * Reactive controller that resolves raw component ids (e.g.
 * ``i2c``) to their catalog ``name`` (e.g. ``I²C Bus``) via the
 * shared ``component-name-cache``. Hosts:
 *
 *   1. Call ``resolve(id)`` from render to get the friendly name,
 *      or the raw id as fallback while the lookup is in flight.
 *   2. Call ``kickoff(ids)`` from ``willUpdate`` to fire-and-forget
 *      fetches for ids whose entry hasn't been cached yet. The
 *      cache subscription requests a host update once a fresh
 *      entry lands so labels appear without user interaction.
 *
 * The API and platform are read through getters so the host can
 * drive context changes (board switch, late context provision)
 * without re-wiring the controller.
 */
export class ComponentNameResolverController implements ReactiveController {
  private _unsubscribe?: () => void;

  constructor(
    private readonly _host: ReactiveControllerHost,
    private readonly _getApi: () => ESPHomeAPI | undefined,
    private readonly _getPlatform: () => string | undefined
  ) {
    _host.addController(this);
  }

  hostConnected(): void {
    this._unsubscribe = subscribeComponentCache(() => {
      this._host.requestUpdate();
    });
  }

  hostDisconnected(): void {
    this._unsubscribe?.();
    this._unsubscribe = undefined;
  }

  /** Friendly catalog name for ``id`` if cached, else the raw id. */
  resolve(id: string): string {
    return getCachedComponent(id, this._getPlatform())?.name ?? id;
  }

  /** Fire-and-forget catalog lookups for any ids not yet cached. */
  kickoff(ids: Iterable<string>): void {
    const api = this._getApi();
    if (!api) return;
    const platform = this._getPlatform();
    for (const id of ids) {
      if (getCachedComponent(id, platform) !== undefined) continue;
      void fetchComponent(api, id, platform).catch(() => {
        // Swallow — callers fall back to the raw id on miss, so a
        // transient backend hiccup shouldn't surface as an error.
      });
    }
  }
}
