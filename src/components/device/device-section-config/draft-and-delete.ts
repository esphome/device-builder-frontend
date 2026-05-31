import toast from "sonner-js";
import { validateEntries } from "../../../util/config-validation.js";
import { setIn } from "../../../util/nested-values.js";
import {
  KEEP_EMPTY_STRING_SECTIONS,
  resolveSectionEntries,
} from "../../../util/section-entry-overrides.js";
import {
  removeSectionFromYaml,
  updateSectionInYaml,
} from "../../../util/yaml-section-values.js";
import { resolveCurrentFromLine } from "../../../util/yaml-sections.js";
import type { ConfigEntryValueChange } from "../config-entry-form.js";
import type { ESPHomeDeviceSectionConfig } from "../device-section-config.js";

// Validates against the *render* schema (resolveSectionEntries), not the raw
// catalog. MAP_SECTIONS (substitutions / packages) carry an irrelevant flat
// catalog schema that doesn't match what the user actually edits in the form —
// using it would surface phantom "missing required" errors per keystroke.
export function flushDraft(host: ESPHomeDeviceSectionConfig): void {
  host._draftTimer = null;
  if (!host._config) return;

  const renderEntries = resolveSectionEntries(host.sectionKey, host._config.entries);
  host._fieldErrors = validateEntries(
    renderEntries,
    host._values,
    host._presentComponents,
    host.board?.esphome.platform ?? null
  );

  const fromLine = resolveCurrentFromLine(host.yaml, host.sectionKey, host.fromLine);
  if (fromLine === undefined) {
    // Section was removed from live YAML between keystroke and debounce
    // (paste / external edit). Drop the splice silently — next picker
    // click re-runs loadConfig against the current YAML.
    host._setDirty(false);
    return;
  }

  const newYaml = updateSectionInYaml(
    host.yaml,
    host.sectionKey,
    host._values,
    fromLine,
    // Substitutions: user-typed key + cleared value is intentional data
    // and must round-trip. Other MAP sections (packages) treat empty value
    // as an unfilled placeholder — packages schema validator rejects
    // empty-string definitions, so dropping placeholders keeps it loadable.
    { keepEmptyStrings: KEEP_EMPTY_STRING_SECTIONS.has(host.sectionKey) }
  );

  host._setDirty(false);

  if (newYaml === host.yaml) return;

  host._lastSelfWrittenYaml = newYaml;
  host.dispatchEvent(
    new CustomEvent("yaml-draft", {
      detail: { yaml: newYaml },
      bubbles: true,
      composed: true,
    })
  );
}

export function onValueChange(
  host: ESPHomeDeviceSectionConfig,
  e: CustomEvent<ConfigEntryValueChange>
): void {
  const { path, value } = e.detail;
  host._values = setIn(host._values, path, value);
  host._setDirty(true);
  const errKey = path.join(".");
  if (host._fieldErrors.has(errKey)) {
    const next = new Map(host._fieldErrors);
    next.delete(errKey);
    host._fieldErrors = next;
  }
  host._scheduleDraftFlush();
}

export async function onDeleteConfirmed(host: ESPHomeDeviceSectionConfig): Promise<void> {
  if (!host._config) return;
  const fromLine = resolveCurrentFromLine(host.yaml, host.sectionKey, host.fromLine);
  if (fromLine === undefined) {
    host._error = host._localize("device.section_delete_error");
    return;
  }
  host._deleting = true;
  host._error = "";
  const title = host._config.title;
  try {
    const newYaml = removeSectionFromYaml(host.yaml, host.sectionKey, fromLine);
    if (newYaml === host.yaml) {
      host._error = host._localize("device.section_delete_error");
      return;
    }
    await host._api.updateConfig(host.configuration, newYaml);
    host._setDirty(false);
    host.dispatchEvent(
      new CustomEvent("yaml-updated", {
        detail: { yaml: newYaml },
        bubbles: true,
        composed: true,
      })
    );
    host.dispatchEvent(
      new CustomEvent("section-select", {
        detail: { sectionKey: null },
        bubbles: true,
        composed: true,
      })
    );
    toast.success(host._localize("device.section_deleted", { name: title }), {
      richColors: true,
    });
  } catch (e) {
    host._error =
      e instanceof Error ? e.message : host._localize("device.section_delete_error");
  } finally {
    host._deleting = false;
  }
}
