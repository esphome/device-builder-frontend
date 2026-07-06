/**
 * Shared plumbing for the inline notice banners shown above a section's form
 * (`<esphome-security-notice>`, `<esphome-deprecation-notice>`): the
 * `apply-section-values` event they use to point the host's draft values at
 * new content. Styles live in `notice-banner.styles.ts`.
 */

/** Detail for the `apply-section-values` event: each change's draft path and
 *  the value to write there (`undefined` removes the key). */
export interface ApplySectionValuesDetail {
  changes: { path: string[]; value: unknown }[];
}

/** Emit `apply-section-values` so the hosting section form splices *changes*
 *  into the unsaved draft and flushes the YAML buffer. */
export function dispatchApplySectionValues(
  target: EventTarget,
  changes: ApplySectionValuesDetail["changes"]
): void {
  target.dispatchEvent(
    new CustomEvent<ApplySectionValuesDetail>("apply-section-values", {
      detail: { changes },
      bubbles: true,
      composed: true,
    })
  );
}
