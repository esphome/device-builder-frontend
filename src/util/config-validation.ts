import type { ConfigEntry } from "../api/types.js";
import { ConfigEntryType } from "../api/types.js";
import { parseFloatWithUnit } from "./float-with-unit.js";
import { parseHexInt } from "./hex-int.js";
import { asMappingList, asRecord } from "./nested-values.js";
import { YamlRawValue } from "./yaml-serialize.js";

/**
 * Determine if a config entry is currently visible.
 *
 * Visibility is the AND of four checks:
 *  1. `hidden === false`
 *  2. The `depends_on` predicate against the current form values
 *  3. `depends_on_component` is present in `presentComponents` (when given)
 *  4. The device's target platform is in ``supported_platforms``
 *     when the entry is platform-gated (when ``targetPlatform`` given)
 *
 * Pass `presentComponents` / `targetPlatform` to honor checks #3 / #4;
 * when omitted those dependencies are treated as satisfied (callers
 * without device-wide context — e.g. add-component before insertion
 * with no board picked — should leave them undefined).
 *
 * Used by both ``filterRenderable`` (deciding what to paint) and
 * ``validateEntries`` (deciding what to validate). Keeping the
 * predicate in one place means a hidden-by-platform field can't be
 * paint-skipped but still validated as required — the failure mode
 * Copilot flagged on PR #226.
 */
export function isEntryVisible(
  entry: ConfigEntry,
  values: Record<string, unknown>,
  presentComponents?: Set<string>,
  targetPlatform?: string | null
): boolean {
  if (entry.hidden) return false;

  // Cross-component dependency: only check when caller provided context.
  if (entry.depends_on_component && presentComponents) {
    if (!presentComponents.has(entry.depends_on_component)) return false;
  }

  // Platform gate: only check when caller provided the target platform.
  // Empty / missing ``supported_platforms`` is "no constraint" (the
  // common case) and the field stays visible.
  if (
    targetPlatform &&
    entry.supported_platforms &&
    entry.supported_platforms.length > 0 &&
    !entry.supported_platforms.includes(targetPlatform)
  ) {
    return false;
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

export function validateEntry(entry: ConfigEntry, raw: unknown): ValidationError | null {
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

  if (entry.type === ConfigEntryType.INTEGER && entry.display_format === "hex") {
    // BigInt-route the hex-typed integer check so cv.hex_uint64_t
    // range bounds stay honest (#944 follow-up). ``Number(String(raw))``
    // would round any value above 2^53 before the comparison, and the
    // catalog's max for uint64 (2^64 - 1) is already imprecise after
    // JSON.parse — comparing a precise input against an imprecise
    // bound is wrong. ``parseHexInt`` accepts the canonical strings
    // the renderer emits and any non-negative decimal a fixture / test
    // might pass; numbers / bigints stringify through the same path.
    const canonical = parseHexInt(String(raw));
    if (canonical === null) {
      return { key: entry.key, code: "validation.not_a_number" };
    }
    if (entry.range) {
      const n = BigInt(canonical);
      const [min, max] = entry.range;
      // ``Math.floor`` / ``Math.ceil`` widen the bounds at sub-integer
      // edges in the lenient direction; the backend's cv.hex_int
      // validator is the source of truth either way.
      if (n < BigInt(Math.floor(min))) {
        return { key: entry.key, code: "validation.min", params: { min } };
      }
      if (n > BigInt(Math.ceil(max))) {
        return { key: entry.key, code: "validation.max", params: { max } };
      }
    }
  } else if (
    entry.type === ConfigEntryType.INTEGER ||
    entry.type === ConfigEntryType.FLOAT
  ) {
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

  if (entry.type === ConfigEntryType.FLOAT_WITH_UNIT) {
    // Validate the numeric portion of the unit-suffixed string. Range
    // checks only apply when the value is in the canonical unit — the
    // catalog's `range` for `cv.frequency` etc. is post-coercion and
    // a user picking `mHz` for a frequency in `Hz` produces a number
    // outside the canonical bounds even when the YAML round-trips
    // fine.
    const parsed = parseFloatWithUnit(raw, entry.unit_options ?? []);
    if (parsed.value === null) {
      return { key: entry.key, code: "validation.not_a_number" };
    }
    const canonicalUnit = entry.unit_options?.[0] ?? "";
    if (entry.range && parsed.unit === canonicalUnit) {
      const [min, max] = entry.range;
      if (parsed.value < min) {
        return { key: entry.key, code: "validation.min", params: { min } };
      }
      if (parsed.value > max) {
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
  targetPlatform?: string | null
): Map<string, ValidationError> {
  const errors = new Map<string, ValidationError>();
  _validateEntriesRecursive(
    entries,
    values,
    presentComponents,
    targetPlatform,
    [],
    errors
  );
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
  targetPlatform: string | null | undefined,
  pathPrefix: string[],
  errors: Map<string, ValidationError>
): void {
  for (const entry of entries) {
    // Skip hidden entries and those whose visibility predicates fail —
    // we don't want to require fields the user can't even see.
    if (!isEntryVisible(entry, values, presentComponents, targetPlatform)) continue;

    if (entry.type === ConfigEntryType.NESTED) {
      const childSchema = entry.config_entries ?? [];
      if (entry.multi_value) {
        // List-form NESTED (``esphome.devices`` / ``esphome.areas``):
        // validate each item independently with an array-index path
        // segment so errors land at ``devices.0.id`` etc. — matching
        // how the form looks errors up via ``path.join(".")``. An
        // empty list on an optional field is fine (the user opted
        // out by adding nothing); a required list with zero items
        // surfaces a single error on the field itself.
        //
        // ``YamlRawValue`` short-circuits — the parser preserved
        // the block byte-for-byte because items don't fit the
        // flat-mapping contract, so we can't introspect them. The
        // user's YAML is present (treats a required field as
        // satisfied) but unreachable for per-item validation.
        const raw = values[entry.key];
        if (raw instanceof YamlRawValue) continue;
        const items = asMappingList(raw);
        if (items.length === 0) {
          if (entry.required) {
            const fullPath = [...pathPrefix, entry.key].join(".");
            errors.set(fullPath, {
              key: fullPath,
              code: "validation.required",
            });
          }
          continue;
        }
        items.forEach((itemValues, idx) => {
          _validateEntriesRecursive(
            childSchema,
            itemValues,
            presentComponents,
            targetPlatform,
            [...pathPrefix, entry.key, String(idx)],
            errors
          );
        });
        continue;
      }
      const childValues = asRecord(values[entry.key]);
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
        childSchema,
        childValues,
        presentComponents,
        targetPlatform,
        [...pathPrefix, entry.key],
        errors
      );
      continue;
    }

    // MAP entries have user-defined keys, not schema-defined ones, so
    // we can't recurse into config_entries the way NESTED does.
    // Required-ness is enforced by checking the map has at least one
    // entry; per-value validation is delegated to ESPHome's own
    // ``validate_yaml`` (yaml-lint-backend.ts) so the form doesn't
    // duplicate-and-drift the upstream validators (e.g.
    // ``packages:`` accepts only the github://gitlab:// shorthand
    // ESPHome's ``GitFile.from_shorthand`` parses; mirroring that
    // regex here would silently drift on any upstream change).
    if (entry.type === ConfigEntryType.MAP) {
      if (entry.required) {
        const map = asRecord(values[entry.key]);
        if (Object.keys(map).length === 0) {
          const fullPath = [...pathPrefix, entry.key].join(".");
          errors.set(fullPath, {
            key: fullPath,
            code: "validation.required",
          });
        }
      }
      continue;
    }

    // Optional defaults aren't sent to the backend (``_coerceFields``
    // strips empties from the API payload), so validating against
    // them is wrong by design — only fall back to ``default_value``
    // for required entries, where an unset value would otherwise
    // surface as ``validation.required`` even though the catalog
    // pre-supplies a valid value.
    const raw = entry.required
      ? (values[entry.key] ?? entry.default_value)
      : values[entry.key];
    const err = validateEntry(entry, raw);
    if (err) {
      const fullPath = [...pathPrefix, entry.key].join(".");
      errors.set(fullPath, { ...err, key: fullPath });
    }
  }
}
