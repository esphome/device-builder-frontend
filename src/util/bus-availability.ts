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
import { parseTopLevelComponents } from "./yaml-serialize.js";
import {
  findFieldLine,
  parseYamlTopLevelSections,
  readInstanceScalar,
  type YamlSection,
} from "./yaml-sections-core.js";

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

/** Bus domains with exclusive-claim semantics worth assessing. */
export const EXCLUSIVE_BUS_DOMAINS: ReadonlySet<string> = new Set(
  Object.keys(BUS_SEMANTICS)
);

export interface BusHostability {
  /** Buses of the domain in the YAML. */
  busCount: number;
  /** Declared `id:` of each bus the candidate can attach to; `null` for
   *  a compatible bus that has no id (referenceable only implicitly). */
  compatibleIds: Array<string | null>;
}

interface BusState {
  id: string | null;
  /** Pin field -> present on the bus block. */
  pins: Record<string, boolean>;
  /** Effective setting values; `null` = unknown (absent with no default,
   *  or a substitution) and matches anything. */
  settings: Record<string, string | null>;
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
  const buses: BusState[] = [];
  const consumers: YamlSection[] = [];
  for (const section of sections) {
    if ((section.parentKey ?? section.key) === busDomain) {
      buses.push(_readBus(yaml, lines, section, semantics));
    } else {
      consumers.push(section);
    }
  }
  if (buses.length === 0) return { busCount: 0, compatibleIds: [] };

  // The native-class gate excludes the host platform from pin
  // exclusivity, and settings mismatches there are esphome's to flag.
  if (parseTopLevelComponents(yaml).has("host")) {
    return { busCount: buses.length, compatibleIds: buses.map((b) => b.id) };
  }

  const refKey = `${busDomain}_id`;
  for (const section of consumers) {
    const constraints = _busConstraintsOf(section, busDomain, constraintsFor);
    if (!constraints) continue;
    const bus = _attachedBus(yaml, lines, section, refKey, buses);
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

function _readBus(
  yaml: string,
  lines: string[],
  section: YamlSection,
  semantics: BusSemantics
): BusState {
  const settings: Record<string, string | null> = {};
  for (const [key, dflt] of Object.entries(semantics.settings)) {
    const raw = _readField(yaml, lines, section, key) ?? dflt;
    settings[key] = raw !== null && hasSubstitutionReference(raw) ? null : raw;
  }
  const pins: Record<string, boolean> = {};
  for (const pin of Object.values(semantics.claims)) {
    pins[pin] = findFieldLine(yaml, section, [pin]) !== null;
  }
  return {
    id: section.id ?? _readField(yaml, lines, section, "id"),
    pins,
    settings,
    claimed: new Set(),
  };
}

/** The section's own catalog `bus_constraints[busDomain]`, else undefined. */
function _busConstraintsOf(
  section: YamlSection,
  busDomain: string,
  constraintsFor: BusConstraintsLookup
): BusConstraintValues | undefined {
  const domain = section.parentKey ?? section.key;
  const catalogId = section.platform ? `${domain}.${section.platform}` : domain;
  return constraintsFor(catalogId)?.[busDomain];
}

/** The bus *section* attaches to: its `<bus>_id`, else the sole bus.
 *  With several buses and no reference the config is already invalid —
 *  the consumer claims nothing. */
function _attachedBus(
  yaml: string,
  lines: string[],
  section: YamlSection,
  refKey: string,
  buses: BusState[]
): BusState | null {
  const ref = _readField(yaml, lines, section, refKey);
  if (ref !== null) return buses.find((b) => b.id === ref) ?? null;
  return buses.length === 1 ? buses[0] : null;
}

function _canHost(
  bus: BusState,
  candidate: BusConstraintValues,
  semantics: BusSemantics
): boolean {
  for (const [flag, pin] of Object.entries(semantics.claims)) {
    if (candidate[flag] === true && (bus.claimed.has(pin) || !bus.pins[pin])) {
      return false;
    }
  }
  for (const key of Object.keys(semantics.settings)) {
    const wanted = candidate[key];
    if (wanted === undefined || wanted === null) continue;
    const actual = bus.settings[key];
    if (actual === null) continue;
    // A list constraint is a choice set (first = default).
    const choices = Array.isArray(wanted) ? wanted : [wanted];
    if (!choices.some((choice) => _settingEquals(actual, choice))) return false;
  }
  return true;
}

function _settingEquals(actual: string, wanted: unknown): boolean {
  if (typeof wanted !== "string" && typeof wanted !== "number") return true;
  return actual.toUpperCase() === String(wanted).toUpperCase();
}

function _readField(
  yaml: string,
  lines: string[],
  section: YamlSection,
  key: string
): string | null {
  const lineNo = findFieldLine(yaml, section, [key]);
  if (lineNo === null) return null;
  return readInstanceScalar(lines[lineNo - 1], key);
}
