import type { ReactiveController, ReactiveControllerHost } from "lit";

import type { ESPHomeAPI } from "../../../api/index.js";
import type { AvailableAutomations } from "../../../api/types/automations.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import {
  loadAndHydrateAvailable,
  resolveLoadedAvailable,
  type HydrateList,
} from "./hydrate-available-bodies.js";

/**
 * Owns the concurrency guard for a catalog-form editor's catalog load
 * (script, api-action, automation). The sequence token lives here, not
 * on the editor, so a load cannot be issued without it: load() is the
 * only entry point and always discards a result superseded by a later
 * load or by host disconnect, so an overlapping load can never clobber
 * the editor's state, paint a stale slim catalog, or double-fire the
 * partial-hydration toast. The editor just assigns the returned fields
 * to its own reactive state.
 */
export class CatalogLoadController implements ReactiveController {
  private _seq = 0;

  constructor(host: ReactiveControllerHost) {
    host.addController(this);
  }

  /** A load resolving after the host detaches must not assign. */
  hostDisconnected(): void {
    this._seq++;
  }

  async load(
    api: ESPHomeAPI | undefined,
    configuration: string,
    localize: LocalizeFunc,
    options?: {
      lists?: readonly HydrateList[];
      onPaint?: (available: AvailableAutomations) => void;
    }
  ): Promise<{ available?: AvailableAutomations; error?: string }> {
    if (!api || !configuration) return {};
    const seq = ++this._seq;
    const onPaint = options?.onPaint;
    const outcome = await loadAndHydrateAvailable(api, configuration, {
      isStale: () => seq !== this._seq,
      // Trigger-less editors (script, api-action) render actions +
      // conditions only; skipping trigger-body hydration avoids needless
      // get_bodies work on mount. automation-editor passes all three to
      // also hydrate the trigger picker.
      lists: options?.lists ?? ["actions", "conditions"],
      // Wrap the caller's early paint in the same staleness check so a
      // superseded load (or a post-disconnect resolve) can't paint a
      // stale slim catalog over a newer load's result.
      onPaint: onPaint
        ? (available) => {
            if (seq !== this._seq) return;
            onPaint(available);
          }
        : undefined,
    });
    // Re-check after the await: a later load (or disconnect) bumped the
    // token, so this result is stale — drop it before it can toast or
    // assign.
    if (seq !== this._seq) return {};
    return resolveLoadedAvailable(outcome, localize);
  }
}
