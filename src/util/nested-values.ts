/**
 * Helpers for reading and writing values inside a nested form-state
 * dict ({ key: value | { key: value } }). The renderers in
 * `<esphome-config-entry-form>` thread a `path: string[]` through every
 * field so a single component can edit values that may live arbitrarily
 * deep — e.g. `temperature.name` for a sub-entry inside a NESTED group.
 */

/**
 * Immutably set `value` at `path` inside an object, returning a new
 * object with structural sharing of untouched branches. Intermediate
 * objects are created when the path crosses missing or non-object
 * nodes (so a fresh form can write to nested fields). Array children
 * are descended via numeric path segments (``["devices", "0",
 * "name"]``), preserving the array shape — required by the
 * nested-list renderer for ``esphome.devices`` / ``esphome.areas``
 * and any future repeatable-mapping field.
 */
export function setIn(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown
): Record<string, unknown> {
  // Empty path → caller is replacing the whole object with *value*
  // (used by top-level map sections like ``substitutions:``, where
  // the entire component IS the user-keyed mapping). Coerce to an
  // empty object when value isn't object-shaped so the caller's
  // contract that this returns a Record<string, unknown> stays
  // intact.
  if (path.length === 0) return isPlainObject(value) ? value : {};
  const [head, ...rest] = path;
  return { ...obj, [head]: _newChild(obj[head], rest, value) };
}

/**
 * Parse a path segment as a non-negative integer index into an
 * array. Returns ``null`` for non-numeric, negative, or fractional
 * segments — callers translate that to "skip this access" (read
 * paths return ``undefined``, write paths leave the array
 * unchanged). Centralised so the read and write sides agree on
 * what counts as a valid array index — an inconsistency between
 * them would let writes land at indices reads can't reach.
 */
function _parseArrayIndex(segment: string): number | null {
  const idx = Number(segment);
  return Number.isInteger(idx) && idx >= 0 ? idx : null;
}

/**
 * Compute the new child to install at the head of a path, given
 * the existing child at that slot. Shared by ``setIn`` (Record
 * containers) and ``_setInArray`` (Array containers); each caller
 * handles its own container-shape spread/copy and just plugs the
 * result of ``_newChild`` in. Empty ``rest`` ⇒ value goes in
 * directly; otherwise descend via the appropriate sibling for the
 * existing child's shape (Array → ``_setInArray``; anything else
 * is coerced to ``{}`` and handed to ``setIn``).
 */
function _newChild(currentChild: unknown, rest: string[], value: unknown): unknown {
  if (rest.length === 0) return value;
  if (Array.isArray(currentChild)) {
    return _setInArray(currentChild, rest, value);
  }
  return setIn(isPlainObject(currentChild) ? currentChild : {}, rest, value);
}

/**
 * Recurse into an array child of ``setIn``. ``path[0]`` must parse
 * as a non-negative integer (non-numeric, negative, or fractional
 * segments leave the array unchanged — writing to ``arr["name"]``
 * or ``arr[-1]`` would silently set a string property on the
 * array, leaving ``.length`` stale). Indices past the end grow
 * the array so the nested-list renderer can write to a
 * freshly-added item before its placeholder object materialises.
 * The returned array is a fresh copy on every write — callers
 * stay structural-sharing-safe.
 */
function _setInArray(
  arr: readonly unknown[],
  path: string[],
  value: unknown
): readonly unknown[] {
  const [head, ...rest] = path;
  const idx = _parseArrayIndex(head);
  if (idx === null) return arr;
  const copy = [...arr];
  copy[idx] = _newChild(arr[idx], rest, value);
  return copy;
}

/**
 * Read the value at `path` inside `obj`. Returns `undefined` for
 * missing paths or when the path crosses a non-object/non-array
 * intermediate. Numeric path segments index into arrays (mirrors
 * the array-aware writes in :func:`setIn`).
 */
export function getIn(obj: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur === null || cur === undefined || typeof cur !== "object") {
      return undefined;
    }
    if (Array.isArray(cur)) {
      const idx = _parseArrayIndex(k);
      if (idx === null || idx >= cur.length) return undefined;
      cur = cur[idx];
      continue;
    }
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/**
 * True when *value* is one of the scalar types ``wa-select`` can
 * carry as its ``value`` attribute: ``string`` / ``number`` /
 * ``boolean``, or ``null`` / ``undefined``.
 *
 * Narrower than the JS spec's "primitive" definition (which also
 * includes ``bigint`` and ``symbol``). YAML doesn't surface those
 * — js-yaml emits numbers for integer literals up to the safe
 * range, strings for everything else — and ``wa-select``'s
 * stringification path doesn't model them either, so the
 * predicate intentionally rejects them along with the actual
 * problem case (null-prototype objects, plain objects, arrays,
 * Maps, Dates, …).
 *
 * Plain objects with a normal prototype would stringify to
 * ``"[object Object]"``, but null-prototype objects (which
 * js-yaml can produce for empty mappings during a partial edit)
 * and any object whose ``Symbol.toPrimitive`` returns
 * non-primitive throw "Cannot convert object to primitive
 * value". Callers that fan a YAML value into a primitive-only
 * sink should gate on this predicate first and skip the sync
 * for non-scalar values rather than crashing on a transient
 * object.
 */
export function isPrimitiveOrNullish(
  value: unknown
): value is string | number | boolean | null | undefined {
  if (value === null || value === undefined) return true;
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean";
}

/**
 * Narrowing predicate: is *value* a plain object (a YAML mapping
 * candidate)? Excludes ``null``, primitives, and arrays. The
 * pin renderer uses this to detect long-form pin values
 * (``{ number: GPIO5, mode: { ... } }``) so it can route
 * GPIO-picker edits to ``path.number`` instead of clobbering the
 * mapping. ``setIn`` uses the same check to decide whether to
 * descend into an existing child object or replace it with a
 * fresh ``{}``. Centralised so both call sites can share one
 * definition of "object I can deep-merge into".
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Coerce *value* to a ``Record<string, unknown>``, falling back to
 * ``{}`` for ``null`` / undefined / primitives / arrays. Used by
 * the filter and validator's NESTED branches when descending into
 * a sub-mapping that the user might have left unset (or filled
 * with mid-edit YAML stragglers like ``key: null``); the recursion
 * keeps a stable shape instead of crashing on
 * ``Object.keys(null)``.
 */
export function asRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

/**
 * Coerce *value* to a list of mapping items, each item coerced to
 * a ``Record`` via :func:`asRecord`. Returns ``[]`` when ``value``
 * isn't an array. Used by every NESTED + ``multi_value=true`` site
 * (filter, validator, path collector, renderer) to iterate
 * ``esphome.devices`` / ``esphome.areas`` rows as a stable
 * ``Record<string, unknown>[]`` regardless of mid-edit YAML
 * weirdness.
 */
export function asMappingList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}
