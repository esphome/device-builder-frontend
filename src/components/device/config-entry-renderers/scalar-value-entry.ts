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
import type { DurationMappingCarrier } from "../../../util/time-period.js";
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
  const entry: ConfigEntry & DurationMappingCarrier = makeConfigEntry({
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

// One entries array per (def, label): a fresh array per render would defeat
// Lit's change detection on the form mount.
const _bodyEntries = new WeakMap<
  ScalarBodied,
  { label: string; entries: ConfigEntry[] }
>();

/** The entries an action / condition's params form renders: its catalog
 *  fields, or for a scalar-bodied one the single value entry labelled
 *  *valueLabel*. */
export function paramEntriesOf(def: ScalarBodied, valueLabel: string): ConfigEntry[] {
  // ``config_entries`` is absent on a row whose body hasn't hydrated yet.
  const fields = def.config_entries ?? [];
  const type = fields.length > 0 ? null : scalarValueType(def);
  if (type === null) return fields;
  const cached = _bodyEntries.get(def);
  if (cached?.label === valueLabel) return cached.entries;
  const entries = [
    makeScalarValueEntry(type, def, {
      key: SCALAR_BODY_PARAM_KEY,
      label: valueLabel,
      required: true,
    }),
  ];
  _bodyEntries.set(def, { label: valueLabel, entries });
  return entries;
}
