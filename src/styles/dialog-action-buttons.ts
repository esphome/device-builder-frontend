import { css } from "lit";

/**
 * Shared chrome for the action-row buttons in app dialogs that
 * own their own button layout (i.e. don't slot through
 * wa-dialog's footer).
 *
 * Provides three classes:
 *
 *   .btn          — base shape (padding / radius / typography /
 *                   transition). Always paired with a variant.
 *   .btn--cancel  — neutral surface chrome. Cancel, Back, Close.
 *   .btn--primary — primary CTA chrome (esphome-primary tinted).
 *                   Continue, Save, Submit. ``:disabled`` greys
 *                   the button so a busy-state caller can lock
 *                   it without re-styling.
 *
 * Distinct from ``modalDialogStyles`` (which scopes its
 * ``.btn`` / ``.btn--cancel`` to the confirm-dialog footer
 * pattern, padding the action row as a wa-dialog body extension)
 * — this helper is consumed by dialogs that render their action
 * row inline within the body and apply their own padding /
 * margin to it. Per-variant colour intents that diverge from
 * the standard primary (destructive ``.btn--confirm``,
 * ``.btn--save-anyway``) stay in the consumer's local styles
 * so each modal can paint its commit affordance correctly.
 *
 * Adding a new dialog with the same action-row shape? Drop
 * this fragment into the consumer's ``static styles`` array.
 * Add a new shared variant here only when it ships with at
 * least two consumers using identical chrome.
 */
export const dialogActionButtonStyles = css`
  .btn {
    padding: var(--esphome-button-padding);
    border-radius: var(--wa-border-radius-m);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    font-family: inherit;
    cursor: pointer;
    border: none;
    transition: background 0.12s;
  }

  .btn--cancel {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-normal);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .btn--cancel:hover:not(:disabled) {
    background: var(--wa-color-surface-border);
  }

  .btn--primary {
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
  }

  .btn--primary:hover:not(:disabled) {
    background: var(--esphome-primary-hover);
  }

  .btn--primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

/**
 * Standalone footer action-row wrapper: a right-aligned button row with
 * the standard dialog-body padding. Sibling to ``dialogActionButtonStyles``
 * so a dialog can adopt the shared ``.actions`` row without pulling in the
 * ``.btn`` chrome (dialogs that self-style their buttons keep those local).
 */
export const dialogActionsRowStyles = css`
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--wa-space-s);
    padding: var(--wa-space-m) 0 var(--wa-space-l);
  }
`;
