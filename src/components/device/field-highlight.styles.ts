import { css } from "lit";

/** One-shot glow for a field the YAML cursor navigated to; in
 *  ``fieldRendererStyles`` so it shares the form's shadow-root scope. */
export const fieldHighlightStyles = css`
  /* Brief glow when navigated to from the YAML cursor — mirrors the
     dashboard's just-added card flash. */
  .field--highlight {
    animation: field-highlight-glow 2s ease-out 1;
  }
  @keyframes field-highlight-glow {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--esphome-primary), transparent 40%);
    }
    50% {
      box-shadow: 0 0 0 6px color-mix(in srgb, var(--esphome-primary), transparent 70%);
    }
    100% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--esphome-primary), transparent 100%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .field--highlight {
      animation: none;
    }
  }
`;
