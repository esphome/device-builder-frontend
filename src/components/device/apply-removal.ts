/**
 * Delete-removal mechanics: the write-through core shared by the
 * automation delete paths and the superseded re-base (#1490). Lives
 * beside the ``RemovedSectionRef`` contract but outside it, so the
 * type module stays free of API and YAML machinery.
 */
import type { ESPHomeAPI } from "../../api/esphome-api.js";
import type { AutomationLocation } from "../../api/types/automations.js";
import { removeSectionFromYaml } from "../../util/yaml-section-values.js";
import { resolveCurrentSectionLine } from "../../util/yaml-sections.js";
import { applyYamlDiff } from "./automation-editor/serialise.js";
import type { RemovedSectionRef, YamlUpdatedDetail } from "./section-editor.js";

/**
 * Shared core of the disk-writing automation deletes (editor engine,
 * manage-list row): recompute the diff against the settled *yaml*,
 * write through, and announce the write with its basis and removed
 * ref. *connected* is read at announce time, after the awaits.
 */
export async function writeAutomationDelete(
  api: Pick<ESPHomeAPI, "deleteAutomation" | "updateConfig">,
  configuration: string,
  location: AutomationLocation,
  yaml: string,
  announce: (connected: boolean, write: YamlUpdatedDetail) => void,
  connected: () => boolean
): Promise<void> {
  const { yaml_diff } = await api.deleteAutomation(configuration, location, yaml);
  const newYaml = applyYamlDiff(yaml, yaml_diff);
  await api.updateConfig(configuration, newYaml);
  announce(connected(), {
    yaml: newYaml,
    basedOn: yaml,
    removed: { kind: "automation", location },
  });
}

/**
 * Re-apply *removed* to *buffer*. Component sections splice
 * client-side; automations recompute their diff via the
 * side-effect-free ``deleteAutomation``. Returns the re-based
 * buffer, or ``null`` when the removal cannot land in it.
 */
export async function applyRemoval(
  removed: RemovedSectionRef,
  buffer: string,
  api: Pick<ESPHomeAPI, "deleteAutomation">,
  configuration: string
): Promise<string | null> {
  if (removed.kind === "automation") {
    const { yaml_diff } = await api.deleteAutomation(
      configuration,
      removed.location,
      buffer
    );
    const next = applyYamlDiff(buffer, yaml_diff);
    return next === buffer ? null : next;
  }
  const line = resolveCurrentSectionLine(buffer, removed.sectionKey, removed.fromLine);
  if (line === undefined) return null;
  const next = removeSectionFromYaml(buffer, removed.sectionKey, line);
  return next === buffer ? null : next;
}
