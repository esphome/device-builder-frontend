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
 * Decide whether *type* on the field keyed *key* should highlight its YAML
 * line, given the currently focused field. ``focusin`` / ``input`` mark the
 * edited field (``input`` is authoritative: it only fires on the live field,
 * so it catches one whose ``focusin`` didn't surface, e.g. a just-added
 * required input). ``input`` re-emits only when focus moved, not mid-typing.
 * ``change`` fires on blur, so it is honored only while its field still holds
 * focus — else moving A→B re-points the highlight back at A.
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
