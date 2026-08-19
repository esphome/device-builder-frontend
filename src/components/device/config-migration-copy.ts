/** Phrasing for the config-migration nudge: one sentence per ``MigrationChange``. */
import type { MigrationChange } from "../../api/types/editor.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { releaseLine } from "../../util/version-mismatch.js";

/** One sentence describing *change*, with its removal / required note. */
export function describeMigrationChange(
  localize: LocalizeFunc,
  change: MigrationChange
): string {
  const esphome = change.since ? `ESPHome ${releaseLine(change.since)}` : "ESPHome";
  const sentence = localize(`device.config_migration_change_${change.kind}`, {
    esphome,
    old: change.old,
    new: change.new,
    scope: change.scope,
  });
  if (change.required) {
    return `${sentence} ${localize("device.config_migration_change_required")}`;
  }
  if (change.removed_in) {
    return `${sentence} ${localize("device.config_migration_change_removed_in", {
      removed_in: releaseLine(change.removed_in),
    })}`;
  }
  return sentence;
}
