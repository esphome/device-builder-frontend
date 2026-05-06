/**
 * Pure response → display-message reducer for ``editor/validate_yaml``.
 *
 * Lifted out of ``device-section-config`` so the empty-message
 * fallback contract is unit-testable in node without spinning up
 * a Lit component. Two shapes the device editor needs to keep
 * apart:
 *
 *   - No errors at all → ``null`` so ``_onSave`` proceeds.
 *   - Error reported but the first one's ``message`` is
 *     empty / whitespace → return the caller's *fallback* so
 *     ``_onSave`` blocks AND the user sees something rendered.
 *     Without the fallback, an empty trim would coalesce to
 *     ``null`` and let the save through despite the backend
 *     reporting a validation error.
 *
 * The caller (``_lintFailureMessage`` in
 * ``device-section-config.ts``) supplies its localized
 * ``device.section_save_error`` as the fallback — kept as a
 * parameter rather than baked in so the helper has no
 * dependency on Lit's ``LocalizeFunc`` context plumbing.
 */
import type { EditorValidateResponse } from "../api/types.js";

export function lintFailureMessageFromResponse(
  res: EditorValidateResponse,
  fallback: string,
): string | null {
  const validation = res.validation_errors?.[0];
  if (validation) {
    const msg = validation.message?.trim();
    return msg || fallback;
  }
  const yaml = res.yaml_errors?.[0];
  if (yaml) {
    const msg = yaml.message?.trim();
    return msg || fallback;
  }
  return null;
}
