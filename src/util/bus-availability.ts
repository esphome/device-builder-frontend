/*
 * Which existing buses of a domain can host a component about to be added.
 *
 * ESPHome's uart final-validate lets each bus carry at most one
 * `require_rx` claimant and one `require_tx` claimant (independent
 * slots), and turns a consumer's declared `baud_rate` / `data_bits` /
 * `parity` / `stop_bits` into exact-match constraints on the bus. The
 * catalog captures those declarations per component as
 * `bus_constraints.<bus>`, so the add flow can predict the collision
 * before writing YAML — a candidate with no compatible bus needs the
 * "+ Add <bus>" detour, not a silent attach to a claimed bus.
 *
 * uart is today the only bus esphome enforces pin exclusivity on (no
 * addressing or chip select — two readers on one rx line interleave
 * garbage); i2c and spi never register claimants. A future bus with
 * the same rule is a `BUS_SEMANTICS` row, not a new flow.
 *
 * Uncertainty fails open (a bus setting we can't read counts as
 * matching): the check exists to prevent a guaranteed validation
 * error, not to second-guess configs it can't parse.
 */
import { hasSubstitutionReference } from "./substitutions.js";
import { parseYamlSectionValues } from "./yaml-section-reader.js";
import { parseYamlTopLevelSections, type YamlSection } from "./yaml-sections-core.js";
import { sectionKeyOf } from "./yaml-sections.js";

/** One catalog entry's `bus_constraints[bus]` dict. */
export type BusConstraintValues = Record<string, unknown>;

/** Catalog `bus_constraints` lookup for a configured component's id. */
export type BusConstraintsLookup = (
  catalogId: string
) => Record<string, BusConstraintValues> | undefined;

interface BusSemantics {
  /** Pin-claim flags: constraint key -> the bus pin field it claims.
   *  ESPHome allows one claimant per pin per bus. */
  claims: Record<string, string>;
  /** Exact-match setting keys, mapped to esphome's default when the
   *  YAML may omit the key (`null` = no default; absent is unknown). */
  settings: Record<string, string | null>;
}

const BUS_SEMANTICS: Record<string, BusSemantics> = {
  uart: {
    claims: { require_rx: "rx_pin", require_tx: "tx_pin" },
    settings: { baud_rate: null, data_bits: "8", parity: "NONE", stop_bits: "1" },
  },
};

/**
 * The first dependency of *entry* on an exclusive-claim bus domain the
 * entry also constrains, with those constraints; null when none.
 */
export function exclusiveBusTarget(entry: {
  dependencies?: string[];
  bus_constraints?: Record<string, BusConstraintValues>;
}): { domain: string; constraints: BusConstraintValues } | null {
  for (const dep of entry.dependencies ?? []) {
    if (!BUS_SEMANTICS[dep]) continue;
    const constraints = entry.bus_constraints?.[dep];
    if (constraints) return { domain: dep, constraints };
  }
  return null;
}

export interface BusHostability {
  /** Buses of the domain in the YAML. */
  busCount: number;
  /** Declared `id:` of each bus the candidate can attach to; `null` for
   *  a compatible bus that has no id (referenceable only implicitly). */
  compatibleIds: Array<string | null>;
}

interface BusState {
  id: string | null;
  /** The bus block's parsed top-level keys. */
  values: Record<string, unknown>;
  /** False when the block's keys arrive from somewhere the line scan
   *  can't see (an anchor merge, an include, a flow mapping) — its pins
   *  and settings are then unknown, not absent. */
  readable: boolean;
  /** Pin fields an existing consumer already claims. */
  claimed: Set<string>;
}

/**
 * Assess which existing buses of *busDomain* can host a candidate
 * declaring *candidate* constraints, given each configured component's
 * own catalog constraints via *constraintsFor*.
 */
export function assessBusHostability(
  yaml: string,
  busDomain: string,
  candidate: BusConstraintValues,
  constraintsFor: BusConstraintsLookup
): BusHostability {
  const semantics = BUS_SEMANTICS[busDomain];
  const sections = parseYamlTopLevelSections(yaml);
  const lines = yaml.split("\n");
  const isBus = (s: YamlSection) => (s.parentKey ?? s.key) === busDomain;
  const buses: BusState[] = sections.filter(isBus).map((s) => {
    const values = parseYamlSectionValues(yaml, s.key, s.fromLine);
    return {
      id: s.id ?? null,
      values,
      readable: Object.keys(values).length > 0 && !_hasHiddenKeys(lines, s),
      claimed: new Set<string>(),
    };
  });
  if (buses.length === 0) return { busCount: 0, compatibleIds: [] };
  // Fail open for a domain without registered semantics.
  if (!semantics) {
    return { busCount: buses.length, compatibleIds: buses.map((b) => b.id) };
  }

  // The native-class gate excludes the host platform from pin
  // exclusivity, and settings mismatches there are esphome's to flag.
  if (sections.some((s) => (s.parentKey ?? s.key) === "host")) {
    return { busCount: buses.length, compatibleIds: buses.map((b) => b.id) };
  }

  const refKey = `${busDomain}_id`;
  for (const section of sections) {
    if (isBus(section)) continue;
    const constraints = constraintsFor(sectionKeyOf(section))?.[busDomain];
    if (!constraints) continue;
    const bus = _attachedBus(yaml, section, refKey, buses);
    if (!bus) continue;
    for (const [flag, pin] of Object.entries(semantics.claims)) {
      if (constraints[flag] === true) bus.claimed.add(pin);
    }
  }

  const compatibleIds = buses
    .filter((bus) => _canHost(bus, candidate, semantics))
    .map((bus) => bus.id);
  return { busCount: buses.length, compatibleIds };
}

/** The bus *section* attaches to: its `<bus>_id`, else the sole bus.
 *  With several buses and no reference the config is already invalid —
 *  the consumer claims nothing. */
function _attachedBus(
  yaml: string,
  section: YamlSection,
  refKey: string,
  buses: BusState[]
): BusState | null {
  const ref = parseYamlSectionValues(yaml, section.key, section.fromLine)[refKey];
  if (ref !== undefined) return buses.find((b) => b.id === String(ref)) ?? null;
  return buses.length === 1 ? buses[0] : null;
}

function _canHost(
  bus: BusState,
  candidate: BusConstraintValues,
  semantics: BusSemantics
): boolean {
  for (const [flag, pin] of Object.entries(semantics.claims)) {
    if (candidate[flag] !== true) continue;
    if (bus.claimed.has(pin)) return false;
    // Pin presence is knowable only on a block the line scan fully read.
    if (bus.readable && !Object.prototype.hasOwnProperty.call(bus.values, pin)) {
      return false;
    }
  }
  if (!bus.readable) return true;
  for (const [key, dflt] of Object.entries(semantics.settings)) {
    const wanted = candidate[key];
    if (wanted === undefined || wanted === null) continue;
    const actual = _busSetting(bus, key, dflt);
    if (actual === null) continue;
    // A list constraint is a choice set (first = default); non-scalar
    // constraint values match anything.
    const choices = (Array.isArray(wanted) ? wanted : [wanted]).filter(
      (c): c is string | number => typeof c === "string" || typeof c === "number"
    );
    if (choices.length === 0) continue;
    if (!choices.some((c) => actual.toUpperCase() === String(c).toUpperCase())) {
      return false;
    }
  }
  return true;
}

/** True when the block pulls keys from a source the line scan can't see:
 *  an anchor merge (`<<:` at any position, including the dash line) or an
 *  include tag. Flow-mapping items parse to zero keys and are caught by
 *  the empty-values half of the `readable` rule instead. */
function _hasHiddenKeys(lines: string[], section: YamlSection): boolean {
  for (let i = section.fromLine - 1; i < section.toLine && i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:-\s+)?<<\s*:/.test(line) || line.includes("!include")) return true;
  }
  return false;
}

/** Effective setting value; `null` = unknown (absent with no default,
 *  or a substitution) and matches anything. */
function _busSetting(bus: BusState, key: string, dflt: string | null): string | null {
  const raw = bus.values[key];
  if (raw === undefined || raw === null) return dflt;
  const text = String(raw);
  return hasSubstitutionReference(text) ? null : text;
}
