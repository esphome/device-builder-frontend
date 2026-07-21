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
    pointer-events: auto;
  }

  .tour-hole {
    position: absolute;
    pointer-events: none;
    border-radius: var(--wa-border-radius-m);
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--esphome-primary), transparent 35%),
      0 0 0 200vmax rgb(0 0 0 / 55%);
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
    <div
      class="tour-hole"
      style=${styleMap(boxStyle(frame.hole))}
      aria-hidden="true"
    ></div>
  `;
}
