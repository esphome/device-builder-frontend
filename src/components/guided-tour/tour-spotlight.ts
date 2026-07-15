import { css, html, type TemplateResult } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import type { Box, TourFrame } from "./tour-geometry.js";

function boxStyle(box: Box): Record<string, string> {
  return {
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.w}px`,
    height: `${box.h}px`,
  };
}

export const tourSpotlightStyles = css`
  .tour-dim {
    position: absolute;
    background: rgb(0 0 0 / 55%);
    pointer-events: auto;
  }
`;

export function renderTourSpotlightBackdrop(frame: TourFrame): TemplateResult {
  return html`
    ${Object.values(frame.dim).map(
      (panel) =>
        html`<div
          class="tour-dim"
          style=${styleMap(boxStyle(panel))}
          aria-hidden="true"
        ></div>`
    )}
  `;
}
