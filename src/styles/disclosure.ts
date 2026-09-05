/**
 * Shared "advanced options" disclosure styling.
 *
 * A button + rotating chevron that toggles `aria-expanded` and reveals a
 * panel, rendered by `renderDisclosure` (src/components/shared/disclosure.ts).
 * Three label looks via the `--link` / `--heading` / `--quiet` modifier:
 *
 * - `--link`: underlined inline link (install-method dialog, create-config wizard)
 * - `--heading`: uppercase quiet row, chevron right-justified (settings expert features)
 * - `--quiet`: small quiet text (per-pin advanced fields)
 *
 * Adding a site? Add this fragment to the consumer's `static styles` and call
 * `renderDisclosure`; keep call-site-specific spacing (toggle `margin-top`,
 * panel-content layout) inline at the call site rather than baking it in here.
 * Cross-site drift is the failure mode this fragment exists to prevent.
 */
import { css } from "lit";

export const disclosureStyles = css`
  .disclosure-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--wa-space-2xs);
    padding: 0;
    background: none;
    border: none;
    font-family: inherit;
    cursor: pointer;
    color: var(--esphome-primary);
  }

  .disclosure-toggle:focus-visible {
    outline: var(--esphome-focus-outline);
    outline-offset: 2px;
  }

  .disclosure-toggle[disabled] {
    cursor: not-allowed;
    opacity: 0.5;
  }

  /* Chevron inherits the button's color (currentColor) and rotates on open.
     Single icon rotated via CSS rather than swapping chevron-up/down names. */
  .disclosure-toggle__chevron {
    font-size: 16px;
    flex-shrink: 0;
    transition: transform 0.15s ease;
  }

  .disclosure-toggle[aria-expanded="true"] .disclosure-toggle__chevron {
    transform: rotate(180deg);
  }

  /* link — underlined inline link; underline targets the label only so the
     chevron doesn't sit on the underline rail. */
  .disclosure-toggle--link {
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
  }

  .disclosure-toggle--link .disclosure-toggle__label {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .disclosure-toggle--link:not([disabled]):hover .disclosure-toggle__label {
    text-decoration: none;
  }

  /* heading — full-width uppercase quiet row with the chevron pushed right. */
  .disclosure-toggle--heading {
    width: 100%;
    justify-content: space-between;
    color: var(--wa-color-text-quiet);
  }

  .disclosure-toggle--heading .disclosure-toggle__label {
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-bold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  /* Heading rows carry a slightly larger chevron than the inline link/quiet
     variants (matches the pre-refactor expert-features disclosure). */
  .disclosure-toggle--heading .disclosure-toggle__chevron {
    font-size: 18px;
  }

  /* quiet — small quiet text that brightens on hover. */
  .disclosure-toggle--quiet {
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
  }

  .disclosure-toggle--quiet:not([disabled]):hover {
    color: var(--wa-color-text-normal);
  }

  .disclosure-panel {
    margin-top: var(--wa-space-s);
  }
`;
