import type { ConfigEntry, RequiredGroup } from "../../../api/types/config-entries.js";
import { fetchComponent } from "../../../util/component-name-cache.js";
import { normalizeHexValues } from "../../../util/hex-int.js";
import { normalizeMaybeValues } from "../../../util/maybe-values.js";
import { loadCatalog } from "../../../util/yaml-completion-catalog.js";
import { platformDomains } from "../../../util/yaml-completion-items.js";
import { parseYamlSectionValues } from "../../../util/yaml-section-reader.js";
import { resolveCurrentFromLine } from "../../../util/yaml-sections.js";
import { parseTopLevelComponents } from "../../../util/yaml-serialize.js";
import type { ESPHomeDeviceSectionConfig } from "../device-section-config.js";

export interface SectionConfigResponse {
  section_key: string;
  section_type: "core" | "component" | "automation";
  title: string;
  description: string;
  docs_url: string;
  icon: string;
  image_url: string;
  entries: ConfigEntry[];
  required_groups: RequiredGroup[];
}

/** Read the loaded section's values from *yaml*. */
function readValues(
  host: ESPHomeDeviceSectionConfig,
  config: SectionConfigResponse,
  yaml: string
): void {
  // Asymmetric with save/delete paths: undefined here means "section
  // not in live yaml" — surface an empty form (silent), since this load
  // is reactive to external mutations, not explicit user intent.
  const resolvedFromLine = resolveCurrentFromLine(yaml, host.sectionKey, host.fromLine);
  const parsedValues = parseYamlSectionValues(yaml, host.sectionKey, resolvedFromLine);
  // Pre-format hex values to canonical "0x…" string form (#410) so a
  // save preserves the user's hex notation even when they only edited
  // an unrelated field. Without this, i2c addresses round-trip from
  // 0x76 to 118 on the next save.
  // Expand maybe_simple_value shorthands (a bare `microphone: mic_id`)
  // into the canonical mapping/list shape the renderers and dotted-path
  // edits address; left as a scalar it renders as an empty list and the
  // first edit clobbers it (#2397).
  host._values = normalizeMaybeValues(
    normalizeHexValues(parsedValues, config.entries),
    config.entries
  );
  host._resolvedFromLine = resolvedFromLine;
  host._presentComponents = parseTopLevelComponents(yaml);
  host._valuesStale = false;
}

/** The YAML changed. When that was not the section's own draft, the form
 *  is told at once and ``_values``, still from before, is stale until read
 *  again. As ``reload()``, a draft on its way out keeps the values it has. */
export function noteYamlChange(host: ESPHomeDeviceSectionConfig): void {
  if (host.yaml === host._lastSelfWrittenYaml) return;
  host._valuesRead++;
  host._valuesStale = host._draftTimer === null;
}

/** Before the form writes: the YAML was edited outside it and the reload
 *  that follows up to a second later has not read the values yet, so read
 *  them now. Written from the old ones, the section would undo that edit
 *  (#1920). The form was told of the edit when it happened. Returns
 *  whether the values were read. */
export function readStaleValues(host: ESPHomeDeviceSectionConfig): boolean {
  if (!host._valuesStale || !host._config) return false;
  readValues(host, host._config, host.yaml);
  return true;
}

export async function loadConfig(host: ESPHomeDeviceSectionConfig): Promise<void> {
  const id = ++host._loadId;
  host._loading = true;
  host._error = "";
  host._setDirty(false);
  if (host._draftTimer) {
    clearTimeout(host._draftTimer);
    host._draftTimer = null;
  }
  host._lastSelfWrittenYaml = null;

  try {
    const platform = host.board?.esphome.platform;
    // Session-scoped cache: a section that re-loads on every keystroke
    // (editor/validate_yaml's post-render refresh) doesn't re-issue the
    // same backend round-trip. Catalog is static JSON, entries immutable.
    const component = await fetchComponent(host._api, host.sectionKey, platform);

    if (id !== host._loadId) return;

    // Use the live YAML the parent passes in — fromLine is relative to it.
    // A _api.getConfig re-fetch would disagree with what the editor pane
    // shows when there are unsaved edits and seed the form from a
    // different section than the user clicked.
    const yaml = host.yaml;

    if (!component) {
      // The catalog only carries dotted ids for platform domains, so a
      // bare ``switch:`` misses too — that is an empty platform section
      // awaiting its first item, not an external component.
      const domain = platformDomains(await loadCatalog(host._api)).has(host.sectionKey);
      if (id !== host._loadId) return;
      // Synthesise a config with no entries so the YAML-only notice
      // fires. Store sectionKey as title (not a localised "External
      // component" label) so the delete confirm + toast read distinctly
      // when a device has multiple unknown sections.
      host._config = {
        section_key: host.sectionKey,
        section_type: "core",
        title: host.sectionKey,
        description: "",
        docs_url: "",
        icon: "",
        image_url: "",
        entries: [],
        required_groups: [],
      };
      host._isPlatformDomain = domain;
      host._isUnknown = !domain;
    } else {
      host._config = {
        section_key: host.sectionKey,
        section_type: "core",
        title: component.name,
        description: component.description,
        docs_url: component.docs_url ?? "",
        icon: "",
        image_url: component.image_url ?? "",
        entries: component.config_entries,
        required_groups: component.required_groups ?? [],
      };
      host._isPlatformDomain = false;
      host._isUnknown = false;
    }
    // Not for the section's own draft, written while this load was waiting.
    if (yaml !== host._lastSelfWrittenYaml) host._valuesRead++;
    readValues(host, host._config, yaml);
  } catch (e) {
    if (id !== host._loadId) return;
    host._config = null;
    host._values = {};
    const msg = e instanceof Error ? e.message : "";
    host._error = msg.includes("timed out")
      ? host._localize("device.load_config_error")
      : msg || host._localize("device.load_config_error");
  } finally {
    if (id === host._loadId) {
      host._loading = false;
      host._reloading = false;
    }
  }
}
