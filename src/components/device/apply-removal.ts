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
import type { YamlUpdatedDetail } from "./section-editor.js";

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
    configuration,
    yaml: newYaml,
    basedOn: yaml,
    removed: { kind: "automation", location },
  });
}

/**
 * Re-apply *write*'s removal to *buffer*. Component sections splice
 * client-side; automations recompute their diff via the
 * side-effect-free ``deleteAutomation``. Returns the re-based
 * buffer, or ``null`` when the removal cannot land in it — including
 * when the re-resolved target removed different lines than the
 * delete did (positional locations and the nearest-line heuristic
 * are not authoritative in a diverged buffer).
 */
export async function applyRemoval(
  write: YamlUpdatedDetail,
  buffer: string,
  api: Pick<ESPHomeAPI, "deleteAutomation">
): Promise<string | null> {
  const { removed, configuration } = write;
  let next: string;
  if (removed.kind === "automation") {
    const { yaml_diff } = await api.deleteAutomation(
      configuration,
      removed.location,
      buffer
    );
    next = applyYamlDiff(buffer, yaml_diff);
  } else {
    const line = resolveCurrentSectionLine(buffer, removed.sectionKey, removed.fromLine);
    if (line === undefined) return null;
    next = removeSectionFromYaml(buffer, removed.sectionKey, line);
  }
  const expected = removedLines(write.basedOn, write.yaml);
  const actual = removedLines(buffer, next);
  if (
    expected === null ||
    actual === null ||
    actual.length === 0 ||
    expected.join("\n") !== actual.join("\n")
  ) {
    return null;
  }
  return next;
}

/** Lines removed going from *before* to *after*, or ``null`` when
 *  the edit is not a pure contiguous removal. */
function removedLines(before: string, after: string): string[] | null {
  const b = before.split("\n");
  const a = after.split("\n");
  let start = 0;
  while (start < a.length && b[start] === a[start]) start++;
  let endB = b.length - 1;
  let endA = a.length - 1;
  while (endA >= start && endB >= start && b[endB] === a[endA]) {
    endB--;
    endA--;
  }
  if (endA >= start) return null;
  return b.slice(start, endB + 1);
}
