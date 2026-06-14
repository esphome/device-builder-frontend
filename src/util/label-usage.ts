/**
 * Helpers for the labels filter / catalog management UI.
 *
 * Lives here (rather than inside ``components/labels/``) so the
 * dashboard can compute the per-id usage map once for the shared
 * ``<esphome-confirm-dialog>``'s "removes from N devices" copy,
 * and so vitest's node environment can exercise the logic without
 * dragging in webawesome's DOM-coupled side-effect modules.
 */

/**
 * Minimum shape ``computeLabelUsage`` needs from a device — just
 * an optional list of label ids. Looser than ``ConfiguredDevice``
 * on purpose: tests can pass simple stubs without filling in the
 * dozen fields the dashboard's WS payload carries, and the
 * ``labels`` slot is nullable so a future API change that
 * introduces a "no labels block on the wire" sentinel doesn't
 * silently regress the helper.
 */
export interface LabelUsageDevice {
  labels?: readonly string[] | null;
}

/**
 * Build a label-id → device-count map from a device list.
 *
 * Powers the "this will remove the label from N devices" copy in
 * the labels filter's delete-confirm dialog. A device with no
 * ``labels`` (``null``, ``undefined``, or an empty array)
 * contributes nothing; ids that appear on multiple devices
 * accumulate. The map only contains keys for labels with at least
 * one device — callers reading a missing key should treat it as
 * zero.
 */
export function computeLabelUsage(
  devices: readonly LabelUsageDevice[]
): Record<string, number> {
  const usage: Record<string, number> = {};
  for (const d of devices) {
    const ids = d.labels;
    if (!ids) continue;
    for (const id of ids) {
      usage[id] = (usage[id] ?? 0) + 1;
    }
  }
  return usage;
}

/**
 * Case-insensitive duplicate-name check, with an optional
 * exclusion for "the label currently being edited".
 *
 * Edit-mode forms need to exclude the label's own current name
 * from the dedup pool — otherwise typing the existing name back
 * into the input falsely flags as duplicate. *editingName* is
 * the case-insensitively-compared escape hatch; pass ``null`` in
 * create mode where there's no label to exclude.
 */
export function isLabelNameDuplicate(
  name: string,
  existingNames: readonly string[],
  editingName: string | null
): boolean {
  const lower = name.trim().toLowerCase();
  if (!lower) return false;
  const editingLower = editingName?.toLowerCase() ?? null;
  for (const candidate of existingNames) {
    const candLower = candidate.toLowerCase();
    if (candLower === editingLower) continue;
    if (candLower === lower) return true;
  }
  return false;
}
