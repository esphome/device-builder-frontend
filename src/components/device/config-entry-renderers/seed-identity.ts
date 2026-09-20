/**
 * Identity seeding for a subtree the user just materialized — a new
 * nested-list row, or a sub-entity switched on. Neither should make the user
 * invent an id (device-builder#2452, #2459). A row serializes as a bare item
 * regardless, so only a required declaring id is prefilled there; a group
 * serializes only once it holds a value, so it seeds whichever identity
 * field its schema offers, if any.
 */
import type { ConfigEntry } from "../../../api/types/config-entries.js";
import {
  addTakenIdsFromValues,
  collectTakenIds,
  generateNestedItemId,
} from "../../../util/default-component-id.js";
import { declaringIdChild } from "../config-entry-render-filter.js";
import type { RenderCtx } from "../config-entry-renderers-shared.js";

/**
 * A unique id for a subtree materializing under *entry*, or null when its
 * schema declares no id to seed.
 *
 * With *requiredOnly* the id has to be required — a list row exists without
 * one, so seeding an optional id there would be noise; a nested group needs a
 * value to serialize, so its optional id is the identity of last resort. The
 * pool spans the document *and* the whole form-values tree: the add dialog's
 * values aren't in the YAML yet, a just-added row may not have flushed
 * through the draft debounce, and a same-key sibling list under another
 * parent row (esp32_ble_server's ``services[].characteristics[]``) is
 * invisible from this list's rows.
 */
export function seedIdFor(
  entry: ConfigEntry,
  ctx: RenderCtx,
  { requiredOnly = false }: { requiredOnly?: boolean } = {}
): { key: string; id: string } | null {
  const idChild = declaringIdChild(entry, requiredOnly);
  return idChild ? { key: idChild.key, id: nextIdFor(entry, ctx) } : null;
}

/** A fresh id for *entry*, unique across the document and the form values. */
export function nextIdFor(entry: ConfigEntry, ctx: RenderCtx): string {
  const taken = collectTakenIds(ctx.yaml);
  addTakenIdsFromValues(ctx.getAt([]), taken);
  return generateNestedItemId(entry.key, taken);
}
