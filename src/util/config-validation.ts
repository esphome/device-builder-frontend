import type { ConfigEntry } from "../api/types.js";
import { ConfigEntryType } from "../api/types.js";

/**
 * Determine if a config entry is currently visible.
 *
 * Visibility is the AND of three checks:
 *  1. `hidden === false`
 *  2. The `depends_on` predicate against the current form values
 *  3. `depends_on_component` is present in `presentComponents` (when given)
 *
 * Pass `presentComponents` to honor the third check; when omitted the
 * cross-component dependency is treated as satisfied (callers without
 * device-wide context — e.g. add-component before insertion — should
 * leave it undefined).
 */
export function isEntryVisible(
  entry: ConfigEntry,
  values: Record<string, unknown>,
  presentComponents?: Set<string>,
): boolean {
  if (entry.hidden) return false;

  // Cross-component dependency: only check when caller provided context.
  if (entry.depends_on_component && presentComponents) {
    if (!presentComponents.has(entry.depends_on_component)) return false;
  }

  if (!entry.depends_on) return true;
  const depValue = values[entry.depends_on];
  if (entry.depends_on_value !== null && entry.depends_on_value !== undefined) {
    return depValue === entry.depends_on_value;
  }
  if (entry.depends_on_value_not !== null && entry.depends_on_value_not !== undefined) {
    return depValue !== entry.depends_on_value_not;
  }
  return true;
}

export interface ValidationError {
  key: string;
  code: string;
  params?: Record<string, string | number>;
}

/* Mirrors esphome's ``ALLOWED_NAME_CHARS`` (const.py) — what
   ``esphome rename`` and the YAML ``name:`` validator both accept.
   Underscore is included because plenty of existing configs already
   use it (e.g. ``master_tv_cabinet_32``), and rejecting it here
   would make those devices un-renamable from the dashboard. We do
   warn separately (see ``getDeviceNameWarning``) because underscores
   aren't valid mDNS hostnames per RFC 952/1123 and produce flaky
   resolution on some networks. The 63-char cap keeps us inside what
   works as a hostname; esphome itself doesn't bound length at the
   rename step but the device wouldn't be reachable past 63 anyway. */
const DEVICE_NAME_RE = /^[a-z0-9_-]+$/;

export function validateDeviceName(name: string): ValidationError | null {
  const trimmed = name.trim();
  if (!trimmed) return { key: "name", code: "validation.required" };
  if (trimmed.length > 63) {
    return { key: "name", code: "validation.max_length", params: { max: 63 } };
  }
  if (!DEVICE_NAME_RE.test(trimmed)) {
    return { key: "name", code: "validation.invalid_device_name" };
  }
  return null;
}

/** Soft warnings for a device name — same return shape as
 *  ``validateDeviceName`` but the dialog renders these in a less
 *  alarming style and lets the user proceed anyway.
 *
 *  Both warnings flag forms that ``esphome rename`` accepts but
 *  RFC 952/1123 forbid in DNS labels:
 *
 *  - Underscore: classic offender, mostly works on home routers
 *    but bites on RFC-strict resolvers.
 *  - Leading or trailing hyphen: same RFC clause, same risk;
 *    common typo when the user means to use a hyphen as a
 *    separator and overshoots. */
export function getDeviceNameWarning(name: string): ValidationError | null {
  const trimmed = name.trim();
  if (trimmed.includes("_")) {
    return { key: "name", code: "validation.device_name_underscore" };
  }
  if (trimmed.startsWith("-") || trimmed.endsWith("-")) {
    return { key: "name", code: "validation.device_name_edge_hyphen" };
  }
  return null;
}

export function validateEntry(
  entry: ConfigEntry,
  raw: unknown,
): ValidationError | null {
  if (entry.hidden) return null;

  const isEmpty =
    raw === undefined ||
    raw === null ||
    (typeof raw === "string" && raw.trim() === "") ||
    (Array.isArray(raw) && raw.length === 0);

  if (entry.required && isEmpty) {
    return { key: entry.key, code: "validation.required" };
  }
  if (isEmpty) return null;

  if (entry.type === ConfigEntryType.INTEGER || entry.type === ConfigEntryType.FLOAT) {
    const num = typeof raw === "number" ? raw : Number(String(raw));
    if (Number.isNaN(num)) {
      return { key: entry.key, code: "validation.not_a_number" };
    }
    if (entry.type === ConfigEntryType.INTEGER && !Number.isInteger(num)) {
      return { key: entry.key, code: "validation.not_an_integer" };
    }
    if (entry.range) {
      const [min, max] = entry.range;
      if (num < min) {
        return { key: entry.key, code: "validation.min", params: { min } };
      }
      if (num > max) {
        return { key: entry.key, code: "validation.max", params: { max } };
      }
    }
  }

  // Validate against the option list when present — but skip the check
  // for fields that opt into custom values (combobox-style entries treat
  // `options` as suggestions, not a fixed set).
  if (entry.options && entry.options.length > 0 && !entry.allow_custom_value) {
    const allowed = entry.options.map((o) => o.value);
    if (!allowed.includes(String(raw))) {
      return { key: entry.key, code: "validation.invalid_option" };
    }
  }

  return null;
}

export function validateEntries(
  entries: ConfigEntry[],
  values: Record<string, unknown>,
  presentComponents?: Set<string>,
): Map<string, ValidationError> {
  const errors = new Map<string, ValidationError>();
  _validateEntriesRecursive(entries, values, presentComponents, [], errors);
  return errors;
}

/**
 * Recurse through `entries`, validating each leaf and descending into
 * NESTED entries. Errors are keyed by the dotted path so callers can
 * look them up by `path.join(".")` (matching how
 * `device-section-config.ts` reads them in `_errorAt`).
 */
function _validateEntriesRecursive(
  entries: ConfigEntry[],
  values: Record<string, unknown>,
  presentComponents: Set<string> | undefined,
  pathPrefix: string[],
  errors: Map<string, ValidationError>,
): void {
  for (const entry of entries) {
    // Skip hidden entries and those whose visibility predicates fail —
    // we don't want to require fields the user can't even see.
    if (!isEntryVisible(entry, values, presentComponents)) continue;

    if (entry.type === ConfigEntryType.NESTED) {
      const child = values[entry.key];
      const childValues =
        child !== null && typeof child === "object" && !Array.isArray(child)
          ? (child as Record<string, unknown>)
          : {};
      // Optional nested groups (e.g. `web_server.auth`) often have
      // required CHILDREN (`auth.username`, `auth.password`). Don't
      // flag those as missing when the user hasn't populated the
      // group at all — that would force them to fill in nested
      // fields just to opt OUT of the optional block. A group is
      // "untouched" when no key under it has been set; once the
      // user types into any field we recurse normally so the
      // remaining required siblings get validated.
      if (!entry.required && Object.keys(childValues).length === 0) {
        continue;
      }
      _validateEntriesRecursive(
        entry.config_entries ?? [],
        childValues,
        presentComponents,
        [...pathPrefix, entry.key],
        errors,
      );
      continue;
    }

    // MAP entries have user-defined keys, not schema-defined ones, so
    // we can't recurse into config_entries the way NESTED does.
    // Required-ness is enforced by checking the map has at least one
    // entry; per-value validation is a future refinement.
    if (entry.type === ConfigEntryType.MAP) {
      if (entry.required) {
        const raw = values[entry.key];
        const map =
          raw !== null && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : null;
        if (!map || Object.keys(map).length === 0) {
          const fullPath = [...pathPrefix, entry.key].join(".");
          errors.set(fullPath, {
            key: fullPath,
            code: "validation.required",
          });
        }
      }
      continue;
    }

    const raw = values[entry.key] ?? entry.default_value;
    const err = validateEntry(entry, raw);
    if (err) {
      const fullPath = [...pathPrefix, entry.key].join(".");
      errors.set(fullPath, { ...err, key: fullPath });
    }
  }
}
