/**
 * Reorder a ConfigEntry list so required entries float above optional
 * ones, used by the add-component dialog (``requiredOnly`` mode) so the
 * user fills mandatory fields first. The section editor mirrors the
 * on-disk YAML order and leaves the list untouched.
 *
 * The float is **stable**: required entries keep their catalog order,
 * and so do the optional ones. ``Array.prototype.filter`` preserves
 * order, so partitioning into two filtered passes is enough.
 *
 * Exclusive groups (pick-one dropdowns) are floated as a unit: if any
 * member of a group is required, every member counts as required. A
 * group renders as a single dropdown at its first member's slot, so
 * floating only some members would split the group across the
 * required/optional boundary.
 */
import type { ConfigEntry } from "../api/types/config-entries.js";

export function floatRequiredFirst(entries: ConfigEntry[]): ConfigEntry[] {
  const groupRequired = new Map<string, boolean>();
  for (const e of entries) {
    if (e.exclusive_group) {
      groupRequired.set(
        e.exclusive_group,
        (groupRequired.get(e.exclusive_group) ?? false) || !!e.required
      );
    }
  }
  const isRequired = (e: ConfigEntry): boolean =>
    e.exclusive_group ? groupRequired.get(e.exclusive_group)! : !!e.required;
  return [...entries.filter(isRequired), ...entries.filter((e) => !isRequired(e))];
}
