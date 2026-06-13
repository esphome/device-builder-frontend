import type { ConfigEntry } from "../api/types/config-entries.js";
import { ConfigEntryType } from "../api/types/config-entries.js";
import { floatWithUnitToBase } from "./float-with-unit.js";

export interface BusPrefill {
  /** Field values the dep-added bus form starts with. */
  fields: Record<string, unknown>;
  /** Bus fields the requester forces (require_tx -> tx_pin). */
  required: string[];
}

/**
 * Bus-form prefill for a requester's `bus_constraints[bus]` dict.
 *
 * Exact-match values prefill unless the bus default already satisfies
 * them; min/max_frequency clamp the default into range; require_* map
 * to their pin fields. Returns null when nothing applies.
 */
export function busConstraintPrefill(
  busEntries: ConfigEntry[],
  constraints: Record<string, unknown>
): BusPrefill | null {
  const fields: Record<string, unknown> = {};
  const required: string[] = [];
  const entryOf = (key: string): ConfigEntry | undefined =>
    busEntries.find((e) => e.key === key);

  let minHz: number | null = null;
  let maxHz: number | null = null;
  for (const [key, value] of Object.entries(constraints)) {
    if (key === "min_frequency") {
      if (typeof value === "number") minHz = value;
      continue;
    }
    if (key === "max_frequency") {
      if (typeof value === "number") maxHz = value;
      continue;
    }
    if (key.startsWith("require_")) {
      if (value === true) required.push(`${key.slice("require_".length)}_pin`);
      continue;
    }
    const entry = entryOf(key);
    const dflt = entry?.default_value;
    if (dflt === null || dflt === undefined || String(dflt) !== String(value)) {
      // Options-style fields ('stop_bits', 'parity') match on strings.
      fields[key] = entry?.type === ConfigEntryType.STRING ? String(value) : value;
    }
  }

  if (minHz !== null || maxHz !== null) {
    const entry = entryOf("frequency");
    const hz = floatWithUnitToBase(entry?.default_value, entry?.unit_options ?? ["Hz"]);
    let target: number | null = null;
    if (hz === null) target = maxHz ?? minHz;
    else if (maxHz !== null && hz > maxHz) target = maxHz;
    else if (minHz !== null && hz < minHz) target = minHz;
    if (target !== null) fields.frequency = _formatHz(target);
  }

  if (Object.keys(fields).length === 0 && required.length === 0) return null;
  return { fields, required };
}

function _formatHz(hz: number): string {
  return hz % 1000 === 0 ? `${hz / 1000}kHz` : `${hz}Hz`;
}
