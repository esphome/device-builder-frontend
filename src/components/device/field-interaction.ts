/**
 * Pure decision for the structured form's field-focus highlight sync,
 * split out so it can be unit-tested without mounting the form element
 * (its ``wa-*`` deps don't load under the node test env).
 */

/** Outcome of a field interaction: whether to (re)highlight the field's
 *  YAML line, and which field is now considered focused. */
export interface FieldFocusDecision {
  emit: boolean;
  focusedKey: string | undefined;
}

/**
 * Decide whether *type* should highlight the field keyed *key*, and the next
 * focused key. ``input`` is authoritative (catches a field whose ``focusin``
 * didn't surface) and re-emits only when focus moved; ``change`` is honored
 * only while its field still holds focus, so moving A to B doesn't re-point at A.
 */
export function decideFieldFocus(
  type: string,
  key: string,
  focusedKey: string | undefined
): FieldFocusDecision {
  if (type === "change") return { emit: key === focusedKey, focusedKey };
  const moved = key !== focusedKey;
  return { emit: type === "focusin" || moved, focusedKey: key };
}
