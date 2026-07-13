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

  .tour-ring {
    position: absolute;
    box-sizing: border-box;
    border: 2px solid var(--esphome-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--esphome-primary), transparent 55%);
    pointer-events: none;
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
      class="tour-ring"
      style=${styleMap({
        ...boxStyle(frame.ring),
        borderRadius: `${frame.ring.radius}px`,
      })}
      aria-hidden="true"
    ></div>
  `;
}
