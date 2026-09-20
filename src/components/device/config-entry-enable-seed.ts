/**
 * What switching an optional NESTED block on writes, and whether a required
 * group demands that block. Context-free, so the render filter (paint), the
 * nested renderer (switch) and the enable toggle (write) all read one answer.
 */
import type { ConfigEntry, RequiredGroup } from "../../api/types/config-entries.js";
import { ConfigEntryType } from "../../api/types/config-entries.js";
import { isEntryVisible } from "../../util/config-validation.js";
import { hasSerializableValue } from "../../util/yaml-serialize.js";
import type { RenderFilterOptions } from "./config-entry-render-filter.js";

/** Keys of the groups in *requiredGroups* that demand a value be set. */
export function demandedKeys(requiredGroups: RequiredGroup[] | undefined): Set<string> {
  const keys = new Set<string>();
  for (const group of requiredGroups ?? []) {
    if (group.kind !== "exactly_one" && group.kind !== "at_least_one") continue;
    group.keys.forEach((key) => keys.add(key));
  }
  return keys;
}

/** Whether *entry*'s schema carries a `name` field to seed a label into. */
function hasNameChild(entry: ConfigEntry): boolean {
  return (entry.config_entries ?? []).some(
    (c) => c.key === "name" && c.type === ConfigEntryType.STRING
  );
}

// A declaring id, never a `references_component` pointer. A *required* one
// counts under any key (tca9548a declares through ``bus_id``); an optional one
// only when literally ``id``, so a catalog entry missing its
// `references_component` flag can't take a generated id into a pointer field.
export function declaringIdChild(
  entry: ConfigEntry,
  requiredOnly: boolean
): ConfigEntry | undefined {
  return (entry.config_entries ?? []).find(
    (c) =>
      c.type === ConfigEntryType.ID &&
      !c.references_component &&
      (c.required || (!requiredOnly && c.key === "id"))
  );
}

/** The child switching *entry* on writes, and its value when that is fixed. */
export interface EnableSeed {
  from: "name" | "id" | "default";
  key: string;
  value?: unknown;
}

/**
 * What switching the still-empty block *entry* on writes, or null.
 *
 * An entity's ``name``, else a declaring id, else, only for a block a group
 * in ``opts.requiredGroups`` demands, the first child the form would show
 * whose default serializes. The paint, the switch and the toggle all read
 * this, so none can offer what the others can't do.
 */
export function enableSeed(
  entry: ConfigEntry,
  opts: RenderFilterOptions
): EnableSeed | null {
  const children = entry.config_entries ?? [];
  // A plain block's ``name`` need not be a display label.
  if (entry.platform_type != null && hasNameChild(entry))
    return { from: "name", key: "name" };
  const id = declaringIdChild(entry, false);
  if (id) return { from: "id", key: id.key };
  // A child's default is written only to satisfy a group; an undemanded
  // entity sub-reading with no identity keeps its no-op.
  if (!isDemanded(entry, opts)) return null;
  const defaulted = children.find(
    (c) =>
      !c.hidden &&
      !c.locked &&
      !c.multi_value &&
      !c.references_component &&
      c.type !== ConfigEntryType.NESTED &&
      c.type !== ConfigEntryType.MAP &&
      hasSerializableValue(c.default_value) &&
      isEntryVisible(
        c,
        {},
        opts.presentComponents,
        opts.targetPlatform,
        opts.rootValues,
        children
      )
  );
  return defaulted
    ? { from: "default", key: defaulted.key, value: defaulted.default_value }
    : null;
}

/** Whether *entry* is an optional block a group in ``opts.requiredGroups``
 *  demands. Groups are scope-local, so only the scope that owns them sets them. */
function isDemanded(entry: ConfigEntry, opts: RenderFilterOptions): boolean {
  return (
    !entry.required &&
    opts.requiredGroups !== undefined &&
    demandedKeys(opts.requiredGroups).has(entry.key)
  );
}

/** Whether *entry* is a demanded block whose enable switch has something to write. */
export function isSwitchable(entry: ConfigEntry, opts: RenderFilterOptions): boolean {
  return isDemanded(entry, opts) && enableSeed(entry, opts) != null;
}
