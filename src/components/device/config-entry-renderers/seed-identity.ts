/**
 * Identity seeding for a subtree the user just materialized — a new
 * nested-list row, or a sub-entity switched on. Both need something in the
 * group for it to serialize at all, and neither should make the user invent
 * an id (device-builder#2452, #2459).
 */
import type { ConfigEntry } from "../../../api/types/config-entries.js";
import { ConfigEntryType } from "../../../api/types/config-entries.js";
import {
  addTakenIdsFromValues,
  collectTakenIds,
  generateNestedItemId,
} from "../../../util/default-component-id.js";
import type { RenderCtx } from "../config-entry-renderers-shared.js";

/** Whether *entry*'s schema carries a `name` field. */
export function hasNameChild(entry: ConfigEntry): boolean {
  return (entry.config_entries ?? []).some((c) => c.key === "name");
}

/**
 * A unique id for a subtree materializing under *entry*, or null when its
 * schema declares no id to seed.
 *
 * With *requiredOnly* the id has to be required — a list row exists without
 * one, so seeding an optional id there would be noise; a nested group needs
 * a value to serialize, so its optional id is the identity of last resort.
 * The pool spans the document *and* the whole form-values tree: the add
 * dialog's values aren't in the YAML yet, a just-added row may not have
 * flushed through the draft debounce, and a same-key sibling list under
 * another parent row (esp32_ble_server's ``services[].characteristics[]``)
 * is invisible from this list's rows.
 */
export function seedIdFor(
  entry: ConfigEntry,
  ctx: RenderCtx,
  { requiredOnly = false }: { requiredOnly?: boolean } = {}
): { key: string; id: string } | null {
  const idChild = (entry.config_entries ?? []).find(
    (c) =>
      c.type === ConfigEntryType.ID &&
      !c.references_component &&
      (c.required || !requiredOnly)
  );
  if (!idChild) return null;
  const taken = collectTakenIds(ctx.yaml);
  addTakenIdsFromValues(ctx.getAt([]), taken);
  return { key: idChild.key, id: generateNestedItemId(entry.key, taken) };
}
