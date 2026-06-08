/**
 * Literal/lambda toggle — the two-button tab strip that swaps a field
 * between its literal value and a ``!lambda`` body. Shared by the
 * templatable config-entry wrapper and the bespoke Delay action
 * renderer so the markup and styling live in one place. The toggle is
 * a pair of buttons rather than a wa-tab-group to keep the markup
 * leaf-cheap and the keyboard story explicit.
 */
import { css, html } from "lit";

import type { LocalizeFunc } from "../../../common/localize.js";

export const literalLambdaToggleStyles = css`
  .templatable-toggle {
    display: inline-flex;
    align-self: flex-start;
    border-radius: var(--wa-border-radius-s);
    background: var(--wa-color-surface-lowered);
    padding: 2px;
  }

  .templatable-toggle button {
    appearance: none;
    border: none;
    background: transparent;
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-semibold);
    padding: 4px 10px;
    border-radius: var(--wa-border-radius-s);
    cursor: pointer;
  }

  .templatable-toggle button.active {
    background: var(--wa-color-surface-default);
    color: var(--wa-color-text-normal);
    box-shadow: var(--wa-shadow-xs);
  }

  .templatable-toggle button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
`;

interface LiteralLambdaToggleOptions {
  isLambda: boolean;
  disabled: boolean;
  localize: LocalizeFunc;
  onSwitch: (toLambda: boolean) => void;
}

export function renderLiteralLambdaToggle({
  isLambda,
  disabled,
  localize,
  onSwitch,
}: LiteralLambdaToggleOptions) {
  return html`
    <div
      class="templatable-toggle"
      role="tablist"
      aria-label=${localize("device.automation_literal")}
    >
      <button
        type="button"
        role="tab"
        class=${!isLambda ? "active" : ""}
        aria-selected=${!isLambda}
        ?disabled=${disabled}
        @click=${() => onSwitch(false)}
      >
        ${localize("device.automation_literal")}
      </button>
      <button
        type="button"
        role="tab"
        class=${isLambda ? "active" : ""}
        aria-selected=${isLambda}
        ?disabled=${disabled}
        @click=${() => onSwitch(true)}
      >
        ${localize("device.automation_lambda")}
      </button>
    </div>
  `;
}
