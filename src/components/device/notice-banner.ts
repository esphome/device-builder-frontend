/**
 * Shared plumbing for the inline notice banners: the banner template, and
 * the `apply-section-values` event the section-form notices use to point
 * the host's draft values at new content. Styles live in
 * `notice-banner.styles.ts`.
 */

import { html, nothing, type TemplateResult } from "lit";

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

/** Shared notice-banner template: icon, body text, optional CTA
 *  (label and handler travel together) with an optional secondary
 *  action beside it, optional dismiss. */
export function renderNoticeBanner(
  opts: {
    icon: string;
    text: unknown;
    dismissLabel?: string;
    onDismiss?: () => void;
  } & (
    | {
        ctaLabel: unknown;
        onCta: () => void;
        secondary?: { label: unknown; onClick: () => void };
      }
    | { ctaLabel?: never; onCta?: never; secondary?: never }
  )
): TemplateResult {
  return html`
    <div class="notice" role="note">
      <wa-icon library="mdi" name=${opts.icon}></wa-icon>
      <div class="body">
        <div class="text">${opts.text}</div>
        ${
          opts.onCta
            ? html`<div class="cta-row">
                <button type="button" class="cta" @click=${opts.onCta}>
                  ${opts.ctaLabel}
                </button>
                ${
                  opts.secondary
                    ? html`<button
                        type="button"
                        class="cta cta--secondary"
                        @click=${opts.secondary.onClick}
                      >
                        ${opts.secondary.label}
                      </button>`
                    : nothing
                }
              </div>`
            : nothing
        }
      </div>
      ${
        opts.onDismiss
          ? html`
              <button
                type="button"
                class="notice-close"
                aria-label=${opts.dismissLabel ?? ""}
                @click=${opts.onDismiss}
              >
                <wa-icon library="mdi" name="close"></wa-icon>
              </button>
            `
          : nothing
      }
    </div>
  `;
}
