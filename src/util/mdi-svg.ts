import { html, nothing, type TemplateResult } from "lit";

/** Inline MDI glyph, 1em and currentColor; for repeated rows, where a
 *  wa-icon element per row is too heavy. */
export function mdiSvg(pathData: string, className?: string): TemplateResult {
  // Single line: whitespace inside the template becomes a text node per row.
  // prettier-ignore
  return html`<svg class=${className ?? nothing} viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d=${pathData}></path></svg>`;
}
