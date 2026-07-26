/**
 * Re-apply a delete's removal to a buffer it was not computed
 * against (#1490). Lives beside the ``RemovedSectionRef`` contract
 * but outside it, so the type module stays free of API and YAML
 * machinery.
 */
import type { ESPHomeAPI } from "../../api/esphome-api.js";
import { removeSectionFromYaml } from "../../util/yaml-section-values.js";
import { resolveCurrentSectionLine } from "../../util/yaml-sections.js";
import { applyYamlDiff } from "./automation-editor/serialise.js";
import type { RemovedSectionRef } from "./section-editor.js";

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
