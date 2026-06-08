import { css } from "lit";

/** Script-parameter list rows and the add-parameter button. */
export const automationEditorScriptParamStyles = css`
  /* Script-parameter list row — one (name, type, remove) tuple per
     declared script parameter. Inline 3-column grid because each
     row has fixed-ish widths and we want them to align tidily. */
  .script-params-list {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
    margin-bottom: var(--wa-space-2xs);
  }

  .script-param-row {
    display: grid;
    grid-template-columns: 1fr 7rem auto;
    gap: var(--wa-space-2xs);
    align-items: center;
  }

  .script-param-remove {
    appearance: none;
    border: 1px solid transparent;
    background: transparent;
    color: var(--wa-color-text-quiet);
    width: 32px;
    height: 32px;
    border-radius: var(--wa-border-radius-s);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .script-param-remove:hover:not(:disabled) {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-normal);
  }

  .script-param-remove:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* Standalone "+ Add parameter" button — same modest styling as
     the nested action-list add buttons (not the prominent
     full-width primary). */
  .script-param-add {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--wa-space-2xs);
    appearance: none;
    border: 1px dashed var(--wa-color-neutral-border-quiet, #d1d5db);
    background: transparent;
    color: var(--wa-color-text-quiet);
    padding: var(--wa-space-2xs) var(--wa-space-s);
    border-radius: var(--wa-border-radius-s);
    cursor: pointer;
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-semibold);
    margin-top: var(--wa-space-2xs);
  }

  .script-param-add:hover:not(:disabled) {
    border-color: var(--wa-color-brand-fill-loud, #0b5cad);
    color: var(--wa-color-brand-fill-loud, #0b5cad);
  }

  .script-param-add:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;
