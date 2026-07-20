/**
 * Auto-reveal of hidden advanced fields (caret follow, backend errors)
 * and the api manage-list caret flash.
 */
import { pathIsAdvanced } from "../../../util/config-entry-tree.js";
import { resolveSectionEntries } from "../../../util/section-entry-overrides.js";
import type { ESPHomeDeviceSectionConfig } from "../device-section-config.js";
import { scrollFlashRow } from "../field-highlight.js";

/**
 * When a backend error lands on an advanced field that's currently
 * hidden, reveal the advanced fields so the inline message is visible.
 */
export function revealAdvancedForErrors(
  host: ESPHomeDeviceSectionConfig,
  changedProperties: Map<string, unknown>
): void {
  if (!changedProperties.has("backendErrors") && !changedProperties.has("_config")) {
    return;
  }
  if (!host.backendErrors.fields.size) return;
  autoRevealAdvanced(
    host,
    [...host.backendErrors.fields.keys()].map((path) => path.split("."))
  );
}

/**
 * When the caret follows to an advanced field that's currently hidden (Show
 * advanced off and the field has no value yet, so it isn't rendered), reveal
 * the section's advanced fields here in willUpdate so the field renders this
 * pass and the form's scroll-to-field can reach it.
 */
export function revealAdvancedForFocus(
  host: ESPHomeDeviceSectionConfig,
  changedProperties: Map<string, unknown>
): void {
  if (!changedProperties.has("focusFieldPath") && !changedProperties.has("_config")) {
    return;
  }
  if (host.focusFieldPath?.length) autoRevealAdvanced(host, [host.focusFieldPath]);
}

/** ``api.actions`` / ``services`` are hidden from the form — the
 *  manage-list below it owns them, so a caret on those keys lands
 *  there instead of on a field that no longer renders. */
export function maybeFlashApiActionsList(host: ESPHomeDeviceSectionConfig): void {
  if (host.sectionKey !== "api") return;
  const head = host.focusFieldPath?.[0];
  if (head !== "actions" && head !== "services") return;
  const key = JSON.stringify(host.focusFieldPath);
  if (key === host._apiListFlashKey) return;
  const list = host.shadowRoot?.querySelector<HTMLElement>(
    "esphome-section-automation-list"
  );
  // The list renders once the section config loads — hold the shot.
  if (!list) return;
  host._apiListFlashKey = key;
  scrollFlashRow(list);
}

/**
 * Reveal the section's hidden advanced fields when any of *paths* is
 * advanced. At most once per section so a later deliberate collapse
 * sticks (mirrors config-entry-form's seed-once nested-disclosure
 * behaviour — auto-reveal shouldn't fight the user's choice).
 */
function autoRevealAdvanced(
  host: ESPHomeDeviceSectionConfig,
  paths: readonly string[][]
): void {
  if (host._showAdvanced || !host._config) return;
  if (host._autoRevealedSections.has(host.sectionKey)) return;
  const entries = resolveSectionEntries(host.sectionKey, host._config.entries);
  if (!paths.some((path) => pathIsAdvanced(entries, path))) return;
  host._autoRevealedSections.add(host.sectionKey);
  host._setShowAdvanced(true);
}
