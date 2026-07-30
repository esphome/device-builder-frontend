import type { ConfigEntry, ConfigPrimitive } from "../api/types/config-entries.js";
import { ConfigEntryType } from "../api/types/config-entries.js";
import {
  isApiEncryptionKeyField,
  isValidApiEncryptionKey,
} from "./api-encryption-key.js";
import { entryAtPath } from "./config-entry-tree.js";
import type { ValidationError } from "./config-validation-core.js";
import { isValuePresent, validateEntry } from "./config-validation-core.js";
import { asMappingList, asRecord, isPrimitiveOrNullish } from "./nested-values.js";
import { isSecretRef } from "./secret-ref.js";
import { looksLikeSubstitution } from "./substitutions.js";
import { YamlRawValue } from "./yaml-serialize.js";

// The per-entry value checks live in `config-validation-core.ts` (a leaf
// module) so this file stays under the file-size band. Re-exported here
// so existing call sites importing them from `./config-validation.js`
// keep working.
export {
  isValuePresent,
  nearCanonicalOption,
  validateEntry,
} from "./config-validation-core.js";
export type { ValidationError } from "./config-validation-core.js";

/**
 * Whether an entry restricted to ``supportedPlatforms`` is allowed on the
 * device's ``targetPlatform``. Empty / missing list is "no constraint";
 * a falsy target (``""`` / null / undefined — platform not yet resolved)
 * allows everything.
 */
export function platformSupported(
  supportedPlatforms: string[] | undefined,
  targetPlatform?: string | null
): boolean {
  if (!targetPlatform) return true;
  if (!supportedPlatforms || supportedPlatforms.length === 0) return true;
  return supportedPlatforms.includes(targetPlatform);
}

/**
 * Determine if a config entry is currently visible.
 *
 * Visibility is the AND of four checks:
 *  1. `hidden === false`, unless the value is already set — a
 *     ``yaml_only`` field present in the YAML stays visible so the
 *     form shows what the config actually contains
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
 * `rootValues` is the component-root value map. A nested entry can
 * depend on a field it isn't a sibling of (e.g. esp32
 * ``framework.advanced.sram1_as_iram`` gated on the top-level
 * ``variant``); ``depends_on`` resolves in ``values`` first, then
 * falls back to ``rootValues``. Omit it and ``depends_on`` stays
 * sibling-scoped as before.
 *
 * Resolution is by key *presence*, not value: a local sibling whose key
 * exists on ``values`` wins (even if its value is ``undefined``); only a
 * key absent from ``values`` falls through to ``rootValues``. So a
 * ``depends_on`` names either a local sibling or a component-root field
 * — not both. The backend keeps ``depends_on`` targets from colliding
 * across nesting levels, so an absent local key can't resolve against a
 * same-named root field it wasn't meant to. (A future explicit
 * root-vs-sibling scope marker would remove the reliance on name
 * uniqueness.)
 *
 * When the dependency resolves to nothing in either scope, its
 * ``default_value`` (looked up in `siblings`, the schema list `entry`
 * belongs to) stands in — YAML omits fields sitting at their default, so
 * an absent ``spi.type`` still means ``single`` and must keep
 * ``miso_pin``/``mosi_pin`` visible (#1972). Omit `siblings` and an
 * unresolved dependency hides the entry as before.
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
  presentComponents?: ReadonlySet<string>,
  targetPlatform?: string | null,
  rootValues?: Record<string, unknown>,
  siblings?: readonly ConfigEntry[]
): boolean {
  if (entry.hidden && !isValuePresent(values[entry.key])) return false;

  // Cross-component dependency: only check when caller provided context.
  if (entry.depends_on_component && presentComponents) {
    if (!presentComponents.has(entry.depends_on_component)) return false;
  }

  // Platform gate: only check when caller provided the target platform.
  if (!platformSupported(entry.supported_platforms, targetPlatform)) {
    return false;
  }

  if (!entry.depends_on) return true;
  // The backend sets at most one of the three gate fields, so the
  // check order below is immaterial. Resolve the dependency in the
  // local scope first, then fall back to the component root so a
  // nested entry can gate on a top-level field.
  let depValue = Object.prototype.hasOwnProperty.call(values, entry.depends_on)
    ? values[entry.depends_on]
    : rootValues?.[entry.depends_on];
  depValue ??= siblings?.find((s) => s.key === entry.depends_on)?.default_value;
  // Type-insensitive across primitives: the parser hands back numbers /
  // booleans for plain scalars (#1360) while catalog gate values may be
  // strings. A non-primitive (or nullish) depValue never matches — so
  // `value` hides and `value_not` shows, and an array can't stringify
  // into a spurious match. The compare is canonical-form, not lexical —
  // a string gate "1.0" misses a numeric 1 (fails closed; gate values
  // are integer or token shaped).
  const gateMatches = (gate: ConfigPrimitive): boolean =>
    (typeof depValue === "string" ||
      typeof depValue === "number" ||
      typeof depValue === "boolean") &&
    String(depValue) === String(gate);
  if (entry.depends_on_value !== null && entry.depends_on_value !== undefined) {
    return gateMatches(entry.depends_on_value);
  }
  if (entry.depends_on_value_not !== null && entry.depends_on_value_not !== undefined) {
    return !gateMatches(entry.depends_on_value_not);
  }
  if (entry.depends_on_value_any != null) {
    return entry.depends_on_value_any.some(gateMatches);
  }
  return true;
}

/**
 * Return a copy of *errors* without *pathKey* and its per-item descendants
 * (``codes`` also clears ``codes.0`` — a multi_value edit emits at the field
 * path, #1348), or ``null`` when nothing matched so callers can skip the
 * state write.
 */
export function clearPathErrors(
  errors: ReadonlyMap<string, ValidationError>,
  pathKey: string
): Map<string, ValidationError> | null {
  const prefix = `${pathKey}.`;
  const stale = [...errors.keys()].filter((k) => k === pathKey || k.startsWith(prefix));
  if (stale.length === 0) return null;
  const next = new Map(errors);
  for (const k of stale) next.delete(k);
  return next;
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

/**
 * Live validation for one just-edited path: the entry's typed checks
 * (range, type, options) without the required-empty nag.
 *
 * Deliberately edit-scoped: only the changed path is checked, so a
 * wrong seeded default stays quiet until submit — the same fresh-signal
 * rule that keeps untouched required fields nag-free. Assumes the
 * edited path was rendered (visibility gates are not re-evaluated) and
 * covers `validateEntry`'s per-value checks only, not the traversal's
 * section-scoped post-checks. An unresolvable path or an empty value
 * yields an empty map; a scalar `multi_value` array is checked per
 * item, keyed `"<path>.<idx>"` like submit-time validation.
 */
export function validateValueAt(
  entries: ConfigEntry[],
  path: string[],
  value: unknown
): Map<string, ValidationError> {
  const errors = new Map<string, ValidationError>();
  const entry = entryAtPath(entries, path);
  if (!entry) return errors;
  const pathKey = path.join(".");
  if (entry.multi_value && Array.isArray(value)) {
    _validateScalarItems(entry, value, pathKey, errors);
    return errors;
  }
  // Emptiness is a submit-only concern (required is the only check
  // that fires on an empty value).
  if (!isValuePresent(value)) return errors;
  const err = validateEntry(entry, value);
  if (err) errors.set(pathKey, { ...err, key: pathKey });
  return errors;
}

export function validateEntries(
  entries: ConfigEntry[],
  values: Record<string, unknown>,
  presentComponents?: ReadonlySet<string>,
  targetPlatform?: string | null,
  sectionKey?: string
): Map<string, ValidationError> {
  const errors = new Map<string, ValidationError>();
  _validateEntriesRecursive(
    entries,
    values,
    presentComponents,
    targetPlatform,
    [],
    errors,
    sectionKey,
    values
  );
  return errors;
}

/**
 * Per-item checks for a scalar `multi_value` list, keyed `"<pathKey>.<idx>"`.
 *
 * A list-of-dicts the schema bundle couldn't type as nested renders
 * YAML-only (the renderer's whole-field bail); per-item scalar checks
 * would flag rows the form never shows. ESPHome's own validate_yaml
 * owns those, same as MAP values.
 */
function _validateScalarItems(
  entry: ConfigEntry,
  items: unknown[],
  pathKey: string,
  errors: Map<string, ValidationError>
): void {
  if (!items.every(isPrimitiveOrNullish)) return;
  items.forEach((item, idx) => {
    if (!isValuePresent(item)) return;
    const err = validateEntry(entry, item);
    if (err) {
      const fullPath = `${pathKey}.${idx}`;
      errors.set(fullPath, { ...err, key: fullPath });
    }
  });
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
  presentComponents: ReadonlySet<string> | undefined,
  targetPlatform: string | null | undefined,
  pathPrefix: string[],
  errors: Map<string, ValidationError>,
  sectionKey: string | undefined,
  rootValues: Record<string, unknown>
): void {
  for (const entry of entries) {
    // Skip hidden entries and those whose visibility predicates fail —
    // we don't want to require fields the user can't even see.
    if (
      !isEntryVisible(
        entry,
        values,
        presentComponents,
        targetPlatform,
        rootValues,
        entries
      )
    )
      continue;

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
            errors,
            sectionKey,
            rootValues
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
        errors,
        sectionKey,
        rootValues
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

    // A scalar multi_value list validates per item with array-index path
    // segments, so one bad row doesn't paint its siblings — the whole array
    // must never reach validateEntry, where it stringifies ("3,5" →
    // not_a_number on every multi-item numeric list, #1348). A blank row
    // beside a real value is mid-edit, not an error. Non-array values (a
    // bare scalar cv.ensure_list accepts, an unset field, a YamlRawValue
    // block) keep the generic field-level path below.
    if (entry.multi_value && Array.isArray(raw)) {
      if (!raw.some(isValuePresent)) {
        // Empty, or only blank rows: required-and-unsatisfied either way.
        // An unset hidden field isn't rendered, so never block on it
        // (validateEntry's rule).
        if (entry.required && !entry.hidden) {
          const fullPath = [...pathPrefix, entry.key].join(".");
          errors.set(fullPath, { key: fullPath, code: "validation.required" });
        }
        continue;
      }
      _validateScalarItems(entry, raw, [...pathPrefix, entry.key].join("."), errors);
      continue;
    }

    const err = validateEntry(entry, raw);
    if (err) {
      const fullPath = [...pathPrefix, entry.key].join(".");
      errors.set(fullPath, { ...err, key: fullPath });
    } else if (
      // Cheap section gate first so non-api leaves never build the path array.
      sectionKey === "api" &&
      typeof raw === "string" &&
      isApiEncryptionKeyField(sectionKey, [...pathPrefix, entry.key]) &&
      isValuePresent(raw) &&
      !looksLikeSubstitution(raw) &&
      !isSecretRef(raw) &&
      !isValidApiEncryptionKey(raw)
    ) {
      // Format-check only the api.encryption.key Noise PSK; a `!secret` ref or
      // a `${substitution}` resolves elsewhere, so neither is base64-checkable.
      const fullPath = [...pathPrefix, entry.key].join(".");
      errors.set(fullPath, { key: fullPath, code: "validation.invalid_encryption_key" });
    }
  }
}
