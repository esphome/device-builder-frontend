import type { ReactiveController, ReactiveControllerHost } from "lit";

import type { ESPHomeAPI } from "../../api/index.js";
import {
  fetchAutomationTriggers,
  getCachedAutomationTriggers,
  subscribeAutomationCatalogCache,
} from "../../util/automation-catalog-cache.js";

/** Host-supplied lookup keys, re-read per call since the host's
 *  api / platform / board can change after construction. */
export interface TriggerCatalogContext {
  api?: ESPHomeAPI;
  platform?: string;
  boardId?: string;
}

/**
 * Shared trigger-catalog access for the device navigator and the
 * component automations list.
 *
 * Subscribes to the catalog cache (re-rendering the host when a fetch
 * lands), kicks off the per-(platform, board) fetch on demand, and
 * resolves a trigger key to its catalog pretty name
 * (``"Binary Sensor → On State"``). The catalog ``name`` already
 * carries the domain prefix, so callers render the resolved value
 * as-is.
 */
export class TriggerCatalogController implements ReactiveController {
  private _unsubscribe?: () => void;

  constructor(
    private readonly _host: ReactiveControllerHost,
    private readonly _context: () => TriggerCatalogContext
  ) {
    _host.addController(this);
  }

  hostConnected(): void {
    this._unsubscribe = subscribeAutomationCatalogCache(() => this._host.requestUpdate());
  }

  hostDisconnected(): void {
    this._unsubscribe?.();
    this._unsubscribe = undefined;
  }

  /** Fire-and-forget the catalog fetch so ``resolveName`` fills in once
   *  it lands; no-op when already cached or when there's no API yet. */
  ensure(): void {
    const { api, platform, boardId } = this._context();
    if (!api) return;
    if (getCachedAutomationTriggers(platform, boardId) !== undefined) return;
    void fetchAutomationTriggers(api, platform, boardId).catch(() => {
      // Swallow — callers fall back to the raw key when the catalog
      // can't load, so a transient backend hiccup isn't surfaced here.
    });
  }

  /** Catalog pretty name for ``<domain>.<event>`` (or the bare event
   *  key for device-level ``esphome``), or ``fallback`` until cached. */
  resolveName(domain: string, eventKey: string, fallback: string): string {
    const { platform, boardId } = this._context();
    const triggers = getCachedAutomationTriggers(platform, boardId);
    if (!triggers) return fallback;
    const catalogId = domain === "esphome" ? eventKey : `${domain}.${eventKey}`;
    return triggers.find((t) => t.id === catalogId)?.name || fallback;
  }
}
