/** Legacy registry aliases kept for reading existing configs — never
 *  offered for new nodes; the migrate nudge (backend
 *  ``editor/migrate_config`` rules) respells them. Enforced by the
 *  action/condition catalog picker only (the trigger picker filters
 *  its own list). */
export const LEGACY_AUTOMATION_IDS: ReadonlySet<string> = new Set([
  "homeassistant.service",
]);
