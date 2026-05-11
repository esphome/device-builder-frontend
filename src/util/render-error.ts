import { html, nothing } from "lit";

/**
 * Shared helpers for rendering an error in dialog / form
 * markup.
 *
 * Two shapes survive in the codebase because they're
 * semantically distinct:
 *
 * - **Inline-validation error** — a ``<span class="field-error">``
 *   placed next to the input that failed. Read by sighted users
 *   as "this field is wrong"; no ``role="alert"`` because the
 *   message follows the visual flow and screen readers
 *   announce it via the label association. The dialogs that
 *   surface per-field validation errors (adopt-dialog,
 *   friendly-name-dialog, clone-device-dialog,
 *   rename-device-dialog, the config-entry renderers) use this
 *   shape.
 *
 * - **Status-region banner error** — a ``<div class="field-error"
 *   role="alert">`` placed below the form, used for
 *   submit-time / wire failures that don't bind to any single
 *   field. ``role="alert"`` so screen readers announce it
 *   even when focus is elsewhere. The dialogs that wrap a WS
 *   command (edit-pairing-endpoint-dialog,
 *   remote-build-job-dialog) use this shape.
 *
 * Both return ``nothing`` for falsy / empty messages so call
 * sites can write ``${renderInlineError(maybeMessage)}`` without
 * a guarding ternary.
 *
 * The ``.field-error`` CSS rule stays per-component for now —
 * moving the colour / typography tokens into ``shared.ts`` is a
 * separate decision; this helper unifies the markup but not
 * the styles.
 */

/**
 * Render an inline ``<span class="field-error">`` next to a
 * form input, or :external:lit:`nothing` when *message* is
 * falsy / empty.
 */
export function renderInlineError(message: string | undefined) {
  if (!message) return nothing;
  return html`<span class="field-error">${message}</span>`;
}

/**
 * Render a status-region ``<div class="field-error" role="alert">``
 * below a form, or :external:lit:`nothing` when *message* is
 * falsy / empty.
 */
export function renderErrorBanner(message: string | undefined) {
  if (!message) return nothing;
  return html`<div class="field-error" role="alert">${message}</div>`;
}
