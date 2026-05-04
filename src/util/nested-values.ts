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
 * nodes (so a fresh form can write to nested fields).
 */
export function setIn(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown,
): Record<string, unknown> {
  if (path.length === 0) return obj;
  const [head, ...rest] = path;
  if (rest.length === 0) return { ...obj, [head]: value };
  const child = obj[head];
  const childObj =
    child !== null && typeof child === "object" && !Array.isArray(child)
      ? (child as Record<string, unknown>)
      : {};
  return { ...obj, [head]: setIn(childObj, rest, value) };
}

/**
 * Read the value at `path` inside `obj`. Returns `undefined` for
 * missing paths or when the path crosses a non-object (e.g. trying to
 * descend into a string or array).
 */
export function getIn(
  obj: Record<string, unknown>,
  path: string[],
): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) {
      return undefined;
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
  value: unknown,
): value is string | number | boolean | null | undefined {
  if (value === null || value === undefined) return true;
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean";
}
