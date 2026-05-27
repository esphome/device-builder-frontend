/**
 * Shared "is this entry going to render?" filter for the
 * config-entry form.
 *
 * Two consumers need to agree on the answer for every entry:
 *
 * 1. ``ESPHomeConfigEntryForm._filterRenderable`` — decides which
 *    entries to actually paint into the DOM.
 * 2. ``ESPHomeAddComponentForm._anyErrorIsVisible`` — decides
 *    whether a validation error has any chance of being seen by
 *    the user (a red ring on a paint that's actually onscreen).
 *
 * If they diverge, validation can flag an error on an entry the
 * filter has dropped: the form bails on submit and the user sees
 * nothing — no red ring, no message — because the field isn't
 * onscreen. Pinning the predicate in one place avoids that.
 *
 * Returns the rendered list (rather than a boolean predicate) so
 * NESTED groups can be skipped when none of their children
 * survive — a child-aware decision the caller can't make
 * locally.
 */

import type { ConfigEntry } from "../../api/types.js";
import { ConfigEntryType } from "../../api/types.js";
import { isEntryVisible } from "../../util/config-validation.js";
import { asMappingList, asRecord, isPlainObject } from "../../util/nested-values.js";
import { YamlRawValue } from "../../util/yaml-serialize.js";

/**
 * Entry keys the form keeps visible even when ``requiredOnly`` is
 * on. ``name`` becomes the entity's friendly name in Home Assistant,
 * so even though most schemas mark it optional we want to ask for
 * it up-front when the user is creating something — fewer trips
 * back to the section editor for a label they always want.
 *
 * Exported as a ``ReadonlySet`` so downstream code can't mutate
 * the global allowlist at runtime.
 */
export const ALWAYS_SHOWN_KEYS: ReadonlySet<string> = new Set(["name"]);

/**
 * Structural ``ConfigEntryType`` members — entries whose role is
 * layout, grouping, or annotation rather than a single editable
 * value. The templatable-field wrapper skips these because a
 * literal/lambda toggle on a divider or a nested group doesn't
 * make sense; only leaf-shaped entries can be templatable.
 */
export function _isStructuralType(t: ConfigEntryType): boolean {
  return (
    t === ConfigEntryType.NESTED ||
    t === ConfigEntryType.MAP ||
    t === ConfigEntryType.DIVIDER ||
    t === ConfigEntryType.LABEL ||
    t === ConfigEntryType.ALERT
  );
}

export interface RenderFilterOptions {
  /** When true, drop non-required leaves (except ALWAYS_SHOWN_KEYS). */
  requiredOnly: boolean;
  /** When false, drop entries marked ``advanced`` UNLESS they (or
   *  a descendant) carry a YAML-supplied value. Pre-filled advanced
   *  fields stay visible without forcing the user through the toggle;
   *  clearing them in YAML lets them collapse back. */
  showAdvanced: boolean;
  /** Pass-through to ``isEntryVisible`` for cross-component checks. */
  presentComponents?: Set<string>;
  /**
   * The device's target platform (``esp32`` / ``esp8266`` /
   * ``rp2040`` / ...). Forwarded to ``isEntryVisible`` which
   * applies the actual platform gate against
   * ``ConfigEntry.supported_platforms``. Keeping the predicate
   * inside ``isEntryVisible`` (rather than re-implementing it
   * here) means ``validateEntries``, which also calls
   * ``isEntryVisible``, stays in lockstep with what the form
   * paints — no flagging required-and-platform-gated fields the
   * user can't even see.
   *
   * ``null`` / ``undefined`` skips the gate — used by the
   * add-component dialog when no board is selected yet.
   */
  targetPlatform?: string | null;
}

/**
 * True when ``entry`` carries a value the user has set (typically
 * loaded from YAML). For leaves, any non-``undefined`` value counts
 * — the YAML parser only adds a key to ``values`` when it's
 * actually present in the document, so "present in ``values``"
 * is the visibility signal we want. Note this is a visibility
 * predicate, not a serialization predicate: an explicit empty
 * scalar (``key: ""``) or null may render once and then be
 * dropped on save by ``serializeYamlValues``, which is fine —
 * the next reload will hide the field.
 *
 * For NESTED entries, recurse into the sub-dict and report true if
 * any descendant leaf is set; an advanced group with at least one
 * filled child needs to render so the child is reachable.
 */
function hasMaterialValue(entry: ConfigEntry, values: Record<string, unknown>): boolean {
  const value = values[entry.key];
  if (entry.type === ConfigEntryType.NESTED) {
    if (entry.multi_value) {
      // Repeatable nested mapping (``esphome.devices`` /
      // ``esphome.areas``): any non-empty array of items counts.
      // We don't recurse — items are user-added, and a freshly
      // added empty ``{}`` still represents user intent (the row
      // exists because they clicked Add). A ``YamlRawValue`` at
      // this key (the parser preserved the block byte-for-byte
      // because the items didn't fit the flat-mapping contract)
      // also counts — the user's YAML must keep showing without
      // a trip through the Advanced toggle.
      if (value instanceof YamlRawValue) return true;
      return Array.isArray(value) && value.length > 0;
    }
    if (!isPlainObject(value)) return false;
    return (entry.config_entries ?? []).some((child) => hasMaterialValue(child, value));
  }
  return value !== undefined;
}

export function filterRenderable(
  entries: ConfigEntry[],
  values: Record<string, unknown>,
  opts: RenderFilterOptions
): ConfigEntry[] {
  const out: ConfigEntry[] = [];
  for (const entry of entries) {
    if (!isEntryVisible(entry, values, opts.presentComponents, opts.targetPlatform)) {
      continue;
    }
    if (entry.advanced && !opts.showAdvanced && !hasMaterialValue(entry, values)) {
      continue;
    }
    if (entry.type === ConfigEntryType.NESTED) {
      // List-form NESTED always renders — the renderer paints the
      // Add button even with zero items, and ``filterRenderable``
      // is called per-item at render time with the item's own
      // scope. Skipping based on the parent ``values`` shape would
      // hide the field exactly when the user needs it.
      if (!entry.multi_value) {
        const renderableChildren = filterRenderable(
          entry.config_entries ?? [],
          asRecord(values[entry.key]),
          opts
        );
        if (renderableChildren.length === 0) continue;
      }
    } else if (
      opts.requiredOnly &&
      !entry.required &&
      !ALWAYS_SHOWN_KEYS.has(entry.key)
    ) {
      // In required-only mode, drop optional leaves outright unless
      // they're on the always-shown allowlist (e.g. ``name``, which
      // is optional but worth asking up-front for
      // sensors/switches/lights).
      continue;
    }
    out.push(entry);
  }
  return out;
}

/**
 * Recursive variant that emits dotted entry paths instead of
 * ConfigEntry objects. Used by the add-component form to
 * cross-check whether a validation-error key lands on something
 * the user can actually see.
 *
 * Same filter rules as :func:`filterRenderable` — built on top of
 * it so the two surfaces can never drift.
 *
 * Emits BOTH leaf paths AND surviving NESTED group paths
 * (``"auth"`` alongside ``"auth.username"``, ``"auth.password"``).
 * The validator never emits errors keyed on the bare group, so
 * ``_anyErrorIsVisible`` doesn't care, but a future caller treating
 * the result as "leaves only" should filter for paths whose key
 * isn't also a NESTED entry's key.
 */
export function collectRenderablePaths(
  entries: ConfigEntry[],
  values: Record<string, unknown>,
  opts: RenderFilterOptions,
  pathPrefix: string[] = [],
  out: Set<string> = new Set()
): Set<string> {
  for (const entry of filterRenderable(entries, values, opts)) {
    if (entry.type === ConfigEntryType.NESTED) {
      const childSchema = entry.config_entries ?? [];
      if (entry.multi_value) {
        // List-form NESTED: emit one path tree per item with the
        // index segment (``devices.0.id``) so
        // ``_anyErrorIsVisible`` can reconcile validation errors
        // keyed on per-item leaves.
        asMappingList(values[entry.key]).forEach((itemValues, idx) => {
          collectRenderablePaths(
            childSchema,
            itemValues,
            opts,
            [...pathPrefix, entry.key, String(idx)],
            out
          );
        });
      } else {
        collectRenderablePaths(
          childSchema,
          asRecord(values[entry.key]),
          opts,
          [...pathPrefix, entry.key],
          out
        );
      }
      out.add([...pathPrefix, entry.key].join("."));
      continue;
    }
    out.add([...pathPrefix, entry.key].join("."));
  }
  return out;
}
