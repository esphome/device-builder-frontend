import { html, nothing, type TemplateResult } from "lit";
import type { LocalizeFunc } from "../common/localize.js";

export interface VisitWebUiLinkOptions {
  /** Per-site class on the anchor; styling stays with each call site. */
  className: string;
  onClick?: (e: Event) => void;
  /** Render the label as visible text (menu item) instead of an icon-only
   *  link carrying it on aria-label/title. */
  withLabel?: boolean;
}

/**
 * Single source of truth for the "open the device web UI" anchor.
 *
 * Centralizes the ``target="_blank"`` + ``rel="noopener noreferrer"`` security
 * pair so a new call site can't drift from it. *url* is a pre-built
 * ``buildWebUiUrl`` result; callers gate on its truthiness.
 */
export function renderVisitWebUiLink(
  url: string,
  localize: LocalizeFunc,
  options: VisitWebUiLinkOptions
): TemplateResult {
  const label = localize("dashboard.action_visit_web_ui");
  // A visible-label menu item carries the text itself, so drop the
  // redundant aria/title there (``nothing`` removes the attribute).
  const a11yLabel = options.withLabel ? nothing : label;
  return html`<a
    class=${options.className}
    href=${url}
    target="_blank"
    rel="noopener noreferrer"
    aria-label=${a11yLabel}
    title=${a11yLabel}
    @click=${options.onClick}
  >
    <wa-icon library="mdi" name="open-in-new"></wa-icon>${
      options.withLabel ? html` ${label}` : nothing
    }
  </a>`;
}
