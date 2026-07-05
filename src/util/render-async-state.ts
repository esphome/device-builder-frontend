import { html, nothing, type TemplateResult } from "lit";

/**
 * Render the loading / error / content ladder shared by data-fetching
 * dialogs. Loading and error surface as a ``.message`` block with the
 * matching ARIA live role (``status`` / ``alert``); once neither is set
 * the call falls through to ``content()``.
 *
 * The consumer keeps its own ``.message`` CSS (padding / colour differ per
 * dialog) and supplies any post-error affordance through ``errorActions``
 * (e.g. a retry row). ``content()`` owns everything past the two leading
 * branches, including a dialog's own empty state.
 */
export interface RenderAsyncStateOptions {
  loading: boolean;
  loadingMessage: string;
  // Any falsy value (``""`` / ``null`` / ``undefined``) means "no error", so a
  // ``string | null`` field can be passed straight through without coercion.
  error: string | null | undefined;
  content: () => TemplateResult | typeof nothing;
  errorActions?: () => TemplateResult | typeof nothing;
}

export function renderAsyncState(
  opts: RenderAsyncStateOptions
): TemplateResult | typeof nothing {
  if (opts.loading) {
    return html`<div class="message" role="status">${opts.loadingMessage}</div>`;
  }
  if (opts.error) {
    return html`<div class="message error" role="alert">${opts.error}</div>
      ${opts.errorActions ? opts.errorActions() : nothing}`;
  }
  return opts.content();
}
