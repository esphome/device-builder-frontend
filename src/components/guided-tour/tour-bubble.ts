import { html, nothing, type TemplateResult } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import type { LocalizeFunc } from "../../common/localize.js";
import type { TourFrame } from "./tour-geometry.js";
import { renderTourSpotlightBackdrop } from "./tour-spotlight.js";
import type { TourStep } from "./tour-steps.js";

interface TourBubbleProps {
  frame: TourFrame;
  step: TourStep;
  stepIndex: number;
  totalSteps: number;
  localize: LocalizeFunc;
  skipHover: boolean;
  pauseHover: boolean;
  onPause: () => void;
  onSkip: () => void;
  onNext: () => void;
}

function caretPosition(start: number, size: number, bubbleStart: number): string {
  const overlapStart = Math.max(0, start - bubbleStart);
  const overlapEnd = start + size - bubbleStart;
  return `clamp(12px, calc((${overlapStart}px + min(100%, ${overlapEnd}px)) / 2 - 6px), calc(100% - 20px))`;
}

function caretStyle(frame: TourFrame): Record<string, string> {
  const { hole, bubble, side } = frame;
  const outside = "-6px";
  if (side === "left" || side === "right") {
    const top = caretPosition(hole.y, hole.h, bubble.top ?? 0);
    return side === "right" ? { left: outside, top } : { right: outside, top };
  }
  const left = caretPosition(hole.x, hole.w, bubble.left);
  return side === "top" ? { bottom: outside, left } : { top: outside, left };
}

export function renderTourBubble(p: TourBubbleProps): TemplateResult {
  const { bubble } = p.frame;
  const bubbleStyle: Record<string, string> = {
    left: `${bubble.left}px`,
    width: `${bubble.width}px`,
    ...(bubble.bottom !== undefined
      ? { bottom: `${bubble.bottom}px` }
      : { top: `${bubble.top ?? 0}px` }),
  };
  return html`
    ${renderTourSpotlightBackdrop(p.frame)}
    <div
      class="bubble"
      role="dialog"
      aria-live="polite"
      aria-label=${p.localize(p.step.titleKey)}
      style=${styleMap(bubbleStyle)}
    >
      <button
        type="button"
        class="btn btn-step-close btn-pause ${p.pauseHover ? "hovered" : ""}"
        aria-label=${p.localize("tour.pause")}
        title=${p.localize("tour.pause")}
        @click=${p.onPause}
      >
        <wa-icon library="mdi" name="close" aria-hidden="true"></wa-icon>
      </button>
      ${
        p.frame.dock
          ? nothing
          : html`<div
              class="caret"
              style=${styleMap(caretStyle(p.frame))}
              aria-hidden="true"
            ></div>`
      }

      <div class="tour-header">
        <span class="tour-name">${p.localize("tour.header")}</span>
        <span class="step-label">
          ${p.localize("tour.step_counter", {
            current: p.stepIndex + 1,
            total: p.totalSteps,
          })}
        </span>
      </div>
      <div class="bubble-scroll">
        <h2>${p.localize(p.step.titleKey)}</h2>
        <p>${p.localize(p.step.bodyKey)}</p>
      </div>
      ${
        p.step.kind === "action"
          ? html`
              <div class="hint">
                <span class="hint-dot" aria-hidden="true"></span>
                ${p.localize(p.step.hintKey ?? "tour.continue")}
              </div>
              <div class="actions action-only">
                <button
                  type="button"
                  class="btn btn-skip ${p.skipHover ? "hovered" : ""}"
                  @click=${p.onSkip}
                >
                  ${p.localize("tour.skip")}
                </button>
              </div>
            `
          : html`
              <div class="actions">
                <button type="button" class="btn btn-skip" @click=${p.onSkip}>
                  ${p.localize("tour.skip")}
                </button>
                <button type="button" class="btn btn-next" @click=${p.onNext}>
                  ${
                    p.stepIndex >= p.totalSteps - 1
                      ? p.localize("tour.finish")
                      : p.localize(p.step.nextLabelKey ?? "tour.next")
                  }
                </button>
              </div>
            `
      }
    </div>
  `;
}

export function renderTourRecovery(
  localize: LocalizeFunc,
  onPause: () => void,
  onSkip: () => void
): TemplateResult {
  return html`
    <div
      class="bubble recovery-bubble"
      role="dialog"
      aria-live="polite"
      aria-label=${localize("tour.unavailable_title")}
    >
      <h2>${localize("tour.unavailable_title")}</h2>
      <p>${localize("tour.unavailable_body")}</p>
      <div class="actions">
        <button type="button" class="btn btn-skip" @click=${onSkip}>
          ${localize("tour.skip")}
        </button>
        <button type="button" class="btn btn-next btn-pause" @click=${onPause}>
          ${localize("tour.pause")}
        </button>
      </div>
    </div>
  `;
}
