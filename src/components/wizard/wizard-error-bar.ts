import { css, html, nothing } from "lit";

import type { LocalizeFunc } from "../../common/localize.js";
import { dialogActionButtonStyles } from "../../styles/dialog-action-buttons.js";

// The backend refusal phrasing, not the bare filename: a device named "secrets" must not match.
const SECRETS_REFUSAL = /\bsecrets\.yaml (has a duplicate key|doesn't parse)\b/;

/** True when *message* is the backend's secrets.yaml refusal (duplicate key or parse failure). */
export function isSecretsRefusal(message: string): boolean {
  return SECRETS_REFUSAL.test(message);
}

/** Styles for ``renderWizardErrorBar``; includes the shared ``.btn`` base. */
export const wizardErrorBarStyles = [
  dialogActionButtonStyles,
  css`
    .error-bar {
      margin-top: var(--wa-space-s);
    }

    .error {
      color: var(--esphome-error);
      font-size: var(--wa-font-size-s);
      margin: 0;
    }

    .error-action {
      margin-top: var(--wa-space-s);
      background: var(--wa-color-danger-fill-loud);
      color: var(--wa-color-danger-on-loud);
    }

    .error-action:hover {
      background: color-mix(in srgb, var(--wa-color-danger-fill-loud) 85%, black);
    }
  `,
];

/** Inline wizard error bar; a secrets.yaml refusal gets an "Open secrets" button. */
export function renderWizardErrorBar(
  message: string,
  localize: LocalizeFunc,
  onOpenSecrets: () => Promise<void>
) {
  if (!message) return nothing;
  return html`<div class="error-bar" role="alert">
    <p class="error">${message}</p>
    ${
      isSecretsRefusal(message)
        ? html`<button
            type="button"
            class="btn error-action"
            @click=${() => void onOpenSecrets()}
          >
            ${localize("wizard.open_secrets")}
          </button>`
        : nothing
    }
  </div>`;
}
