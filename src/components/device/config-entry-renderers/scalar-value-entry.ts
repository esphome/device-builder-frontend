/**
 * The synthetic ConfigEntry for a catalog entry whose whole body is one
 * value rather than a mapping of fields: a filter (`throttle: 10s`), a
 * light effect, or an action / condition (`delay: 2s`). Routing that value
 * through a real ConfigEntry lets it reuse the regular field widgets and
 * the literal / lambda toggle.
 */
import {
  type AutomationAction,
  type AutomationCondition,
  type RegistryCatalogEntry,
  SCALAR_BODY_PARAM_KEY,
} from "../../../api/types/automations.js";
import { type ConfigEntry, ConfigEntryType } from "../../../api/types/config-entries.js";
import { makeConfigEntry } from "../../../util/config-entry-defaults.js";
import { VALUE_TYPE_TO_CONFIG_TYPE } from "./registry-list-helpers.js";

type ScalarValued = Pick<
  RegistryCatalogEntry,
  "value_type" | "templatable" | "duration_min_unit"
>;

/** The widget type a catalog entry's ``value_type`` maps to, or null when
 *  it has none (or one this build doesn't know). */
export function scalarValueType(
  source: ScalarValued | undefined
): ConfigEntryType | null {
  const tagged = source?.value_type;
  // hasOwnProperty rather than ``in`` so a prototype-chain key from a
  // non-typed payload can't resolve to a non-ConfigEntryType value.
  return tagged && Object.prototype.hasOwnProperty.call(VALUE_TYPE_TO_CONFIG_TYPE, tagged)
    ? VALUE_TYPE_TO_CONFIG_TYPE[tagged]
    : null;
}

/** Build the entry for a scalar value of *type* described by *source*. */
export function makeScalarValueEntry(
  type: ConfigEntryType,
  source: ScalarValued | undefined,
  overrides: Partial<ConfigEntry> = {}
): ConfigEntry {
  const entry = makeConfigEntry({
    type,
    templatable: source?.templatable ?? false,
    ...overrides,
  });
  if (type === ConfigEntryType.TIME_PERIOD) {
    entry.accepts_duration_mapping = true;
    if (source?.duration_min_unit) entry.duration_min_unit = source.duration_min_unit;
  }
  return entry;
}

type ScalarBodied = AutomationAction | AutomationCondition;

// One entries array per definition: the form tells its target by its
// entries, so they must outlive a render and a change of language alike.
const _bodyEntries = new WeakMap<ScalarBodied, ConfigEntry[]>();

/** The entries an action / condition's params form renders: its catalog
 *  fields, or for a scalar-bodied one (``delay: 2s``) the single value
 *  entry. Empty when it has neither. */
export function paramEntriesOf(def: ScalarBodied): ConfigEntry[] {
  const type = def.config_entries.length > 0 ? null : scalarValueType(def);
  if (type === null) return def.config_entries;
  let entries = _bodyEntries.get(def);
  if (!entries) {
    entries = [
      makeScalarValueEntry(type, def, {
        key: SCALAR_BODY_PARAM_KEY,
        label: "Value",
        translation_key: "device.automation_action_delay_value",
        required: true,
      }),
    ];
    _bodyEntries.set(def, entries);
  }
  return entries;
}
