import type { ReactiveController, ReactiveControllerHost } from "lit";

import type { ESPHomeAPI } from "../../api/index.js";
import {
  fetchAutomationTriggers,
  getCachedAutomationTriggers,
  subscribeAutomationCatalogCache,
} from "../../util/automation-catalog-cache.js";
import { triggerForKey } from "./automation-editor/trigger-identity.js";

/** Host-supplied lookup keys, re-read per call since the host's
 *  api / platform / board can change after construction. */
export interface TriggerCatalogContext {
  api?: ESPHomeAPI;
  platform?: string;
  boardId?: string;
}

/** ``applies_to`` scopes of a handler row: its domain, plus
 *  ``<domain>.<platform>`` when a platform item hosts it. */
export function handlerScopes(parentKey: string, platform?: string): string[] {
  return platform ? [parentKey, `${parentKey}.${platform}`] : [parentKey];
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

  /** Catalog pretty name of the trigger hosting ``eventKey`` within
   *  ``scopes`` (the bare event key is the id for device-level
   *  ``esphome``), or ``fallback`` until cached. */
  resolveName(scopes: readonly string[], eventKey: string, fallback: string): string {
    const { platform, boardId } = this._context();
    const triggers = getCachedAutomationTriggers(platform, boardId);
    if (!triggers) return fallback;
    const match = scopes.includes("esphome")
      ? triggers.find((t) => t.id === eventKey)
      : triggerForKey(triggers, scopes, eventKey);
    return match?.name || fallback;
  }

  /** True when the catalog has a component trigger scoped to any of
   *  `scopes` (a section's bare domain and its qualified
   *  ``<domain>.<platform>`` — triggers list one or the other). Fails open
   *  until the catalog loads so existing automations aren't briefly hidden
   *  mid-fetch. */
  hasTriggersFor(scopes: string[]): boolean {
    const { platform, boardId } = this._context();
    const triggers = getCachedAutomationTriggers(platform, boardId);
    if (!triggers) return true;
    return triggers.some((t) => t.applies_to.some((a) => scopes.includes(a)));
  }
}
