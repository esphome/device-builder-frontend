/**
 * Apply a single path-addressed value change into a params dict,
 * returning a fresh object so Lit's property-update mechanism
 * re-renders. Used by the automation and script editors to fold
 * ``<esphome-config-entry-form>`` patch events into their
 * ``trigger_params`` dict.
 *
 * Semantics:
 * - ``path.length === 0``: replace the whole dict. An object value
 *   becomes a shallow copy of itself; anything else clears the dict.
 * - leaf write (last path segment): an ``undefined`` or empty-string
 *   value deletes the key (so a cleared field drops out of the YAML
 *   rather than round-tripping an empty entry); otherwise it sets it.
 * - nested path: recurse into the child dict, materializing an empty
 *   object when the current child isn't a plain object.
 *
 * The script form's shape is flat (one level of keys), so in practice
 * it only ever exercises the length-0 and leaf branches; the recursive
 * branch is what the automation editor's nested forms need.
 */
export function applyParamPatch(
  params: Record<string, unknown>,
  path: string[],
  value: unknown
): Record<string, unknown> {
  if (path.length === 0) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return { ...(value as Record<string, unknown>) };
    }
    return {};
  }
  const [head, ...rest] = path;
  if (rest.length === 0) {
    if (value === undefined || value === "") {
      const next = { ...params };
      delete next[head];
      return next;
    }
    return { ...params, [head]: value };
  }
  const child =
    params[head] && typeof params[head] === "object" && !Array.isArray(params[head])
      ? (params[head] as Record<string, unknown>)
      : {};
  return {
    ...params,
    [head]: applyParamPatch(child, rest, value),
  };
}
