import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { ConfigEntry } from "../../api/types/config-entries.js";
import { collectRenderablePaths } from "./config-entry-render-filter.js";

/**
 * Dotted paths the add-component form would paint for *entries* under its
 * fixed filter: required-only, no advanced toggle (the inner config-entry
 * form is always mounted `required-only` and the add-form never exposes a
 * show-advanced toggle). The single source of truth for "what the add-form
 * shows" — the dialog's fast-path gate and the form's error-visibility
 * check both read it so they can't drift from the actual paint.
 */
export function addFormRenderablePaths(
  entries: ConfigEntry[],
  values: Record<string, unknown>,
  board: BoardCatalogEntry | null,
  presentComponents: ReadonlySet<string>
): Set<string> {
  return collectRenderablePaths(entries, values, {
    requiredOnly: true,
    showAdvanced: false,
    presentComponents,
    targetPlatform: board?.esphome.platform ?? null,
  });
}
