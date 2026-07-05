/**
 * Shared post-upsert dispatch for the "+ Add automation" and
 * "+ Add script" wizard dialogs.
 *
 * Both dialogs finish the same way after a successful
 * ``automations/upsert``: apply the backend-emitted splice to the
 * dialog's YAML buffer and notify the page. Kept in one place so
 * the event names, detail shapes, and bubbling/composed flags
 * can't drift between the two wizards.
 */
import type { AutomationLocation, YamlDiff } from "../../api/types/automations.js";
import { applyYamlDiff, sectionKeyFromLocation } from "./automation-editor/serialise.js";

/**
 * Apply ``yamlDiff`` to ``yaml`` and dispatch the two bubbling,
 * composed events the device page listens for:
 *
 * - ``yaml-draft`` (``detail: { yaml }``) — the spliced YAML, so
 *   the new automation lands in the page's YAML state (and thus
 *   the YAML pane + the global save button see the change). The
 *   page advances ``_yaml`` without touching ``_savedYaml`` —
 *   that's the existing "dirty buffer, click Save to write" path.
 * - ``automation-added`` (``detail: { sectionKey }``) — so the
 *   parent navigator can route to the new section's editor.
 */
export function dispatchAutomationAdded(
  host: HTMLElement,
  yaml: string,
  location: AutomationLocation,
  yamlDiff: YamlDiff
): void {
  const newYaml = applyYamlDiff(yaml, yamlDiff);
  host.dispatchEvent(
    new CustomEvent<{ yaml: string }>("yaml-draft", {
      detail: { yaml: newYaml },
      bubbles: true,
      composed: true,
    })
  );
  host.dispatchEvent(
    new CustomEvent<{ sectionKey: string }>("automation-added", {
      detail: { sectionKey: sectionKeyFromLocation(location) },
      bubbles: true,
      composed: true,
    })
  );
}
