import { css } from "lit";

/* Continuation of the config-entry-form field stylesheet, split out
   to keep each file under the repo size cap. Composed immediately
   after `configEntryFormStyles` in `fieldRendererStyles` so the rule
   order — and therefore the cascade — is identical to the original
   single sheet. */
export const configEntryFormExtraStyles = css`
  /* Per-entry render-error tile. A renderer that throws (or
     receives a malformed entry shape) would otherwise leave a
     silent gap in the form — the user can't tell whether their
     data is gone or the form just doesn't show that field. The
     tile makes the failure visible with the entry's key/type
     and the error message so a user can report the problem
     instead of silently losing their work. */
  .render-error {
    display: flex;
    gap: var(--wa-space-s);
    align-items: flex-start;
    padding: var(--wa-space-s);
    border: 1px solid var(--wa-color-danger-fill-loud, currentColor);
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-danger-fill-quiet, transparent);
    color: var(--wa-color-danger-on-quiet, currentColor);
  }
  .render-error wa-icon {
    flex-shrink: 0;
    margin-top: 2px;
  }
  .render-error > div {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
    min-width: 0;
  }
  .render-error-key {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: var(--wa-font-size-xs);
    opacity: 0.85;
  }
  .render-error-message {
    margin: 0;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: var(--wa-font-size-xs);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .textarea-field {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: var(--wa-font-size-xs);
    padding: var(--wa-space-s);
    border-radius: var(--wa-border-radius-m);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    background: var(--wa-color-surface-default);
    color: var(--wa-color-text-normal);
    resize: vertical;
    min-height: 80px;
  }

  .textarea-field.invalid {
    border-color: var(--esphome-error);
  }

  /* ─── Pin selector option layout ─────────────────────────── */
  .pin-option-stack {
    display: inline-flex;
    flex-direction: column;
    gap: 1px;
    line-height: 1.25;
  }

  .pin-option-primary {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-normal);
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .pin-option-secondary {
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
    font-style: italic;
  }

  .pin-option[disabled] .pin-option-primary,
  .pin-option[disabled] .pin-option-secondary {
    color: var(--wa-color-text-quiet);
  }

  .pin-warn-icon {
    color: var(--esphome-warning, #d97706);
    font-size: 14px;
    flex-shrink: 0;
  }

  .pin-option--warn .pin-option-secondary {
    color: var(--esphome-warning, #d97706);
    font-style: normal;
  }

  /* Section labels for the Recommended / Other pins groups in the GPIO
     picker (issue #1012). Presentational only — wa-select skips
     non-option children for selection / keyboard nav. */
  .pin-group-label {
    display: block;
    padding: var(--wa-space-2xs) var(--wa-space-s) 0;
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--wa-color-text-quiet);
  }

  .pin-group-divider {
    margin: var(--wa-space-2xs) 0;
  }

  /* ─── Pin "Advanced" disclosure (long-form fields) ──────── */
  /* Compact toggle that opens the long-form pin fields (mode
     flags, inverted) attached by the catalog's
     _pin_long_form_extras helper. Visually subordinate to the
     primary GPIO picker — the user has to opt in to the
     advanced fields per pin. */
  .pin-advanced {
    margin-top: var(--wa-space-2xs);
  }

  /* Keep the toggle's original vertical hit area (the shared base is flush). */
  .pin-advanced .disclosure-toggle {
    padding: 2px 0;
  }

  /* The shared disclosure renders the quiet toggle + panel; the bordered indent
     rail for the long-form fields is pin-specific, scoped to this disclosure's
     panel so it overrides the shared margin-only default. */
  .pin-advanced .disclosure-panel {
    margin-top: var(--wa-space-xs);
    padding-left: var(--wa-space-s);
    border-left: 2px solid var(--wa-color-surface-border);
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-s);
  }

  /* ─── Pin wiring presets ─────────────────────────────────── */
  .pin-wiring-banner {
    margin: 0;
  }

  .pin-wiring-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: var(--wa-space-xs);
  }

  .pin-wiring-card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--wa-space-xs) var(--wa-space-s);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    background: none;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: var(--wa-color-text-normal);
  }

  .pin-wiring-card:hover:not([disabled]) {
    border-color: var(--wa-color-brand-border-loud);
  }

  .pin-wiring-card--selected {
    border-color: var(--wa-color-brand-border-loud);
    box-shadow: inset 0 0 0 1px var(--wa-color-brand-border-loud);
  }

  .pin-wiring-card--unavailable {
    cursor: not-allowed;
  }

  .pin-wiring-card[disabled] {
    opacity: 0.6;
    cursor: default;
  }

  .pin-wiring-card-title {
    display: flex;
    align-items: center;
    gap: var(--wa-space-2xs);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
  }

  .pin-wiring-badge {
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-normal);
    padding: 0 var(--wa-space-2xs);
    border-radius: var(--wa-border-radius-s);
    background: var(--wa-color-brand-fill-quiet);
    color: var(--wa-color-brand-text-quiet);
  }

  .pin-wiring-card-desc {
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
  }

  .pin-wiring-card-desc--reason {
    color: var(--esphome-warning, #d97706);
  }

  /* What the preset writes, in mode-flag vocabulary — the quick read
     for users who already know what a pull-up is. */
  .pin-wiring-card-tech {
    font-family: var(--wa-font-family-code);
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
  }

  .pin-wiring-diagram {
    height: 30px;
    align-self: flex-start;
    color: var(--wa-color-text-quiet);
  }

  /* The schematic SVGs ship as asset files and are applied as a mask so
     the drawing takes the theme's text color in light and dark mode. */
  .pin-wiring-diagram--mask {
    width: 140px;
    background-color: var(--wa-color-text-quiet);
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-position: left center;
    -webkit-mask-size: contain;
    mask-repeat: no-repeat;
    mask-position: left center;
    mask-size: contain;
  }

  .pin-wiring-diagram--icon {
    display: flex;
    align-items: center;
    font-size: 22px;
  }

  .pin-wiring-custom {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-s);
  }

  .pin-wiring-row {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
  }

  .pin-wiring-radios wa-radio {
    font-size: var(--wa-font-size-s);
  }

  /* wa-radio's checked dot is "fill: currentColor", and its
     ":host(:state(checked)) .control { color: ... }" rule ties on specificity
     with the default "color: transparent" — the attribute selector wins the
     tie, so the dot renders invisible. One generic rule for every form
     radio group (constraint clusters, pin wiring). */
  wa-radio[aria-checked="true"]::part(control) {
    color: var(--wa-form-control-activated-color) !important;
  }

  /* Board-preset wiring guard: view-only until the unlock is flipped. */
  .pin-wiring-guard {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    padding: var(--wa-space-xs) var(--wa-space-s);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
  }

  .pin-wiring-guard > wa-icon {
    flex-shrink: 0;
    color: var(--wa-color-text-quiet);
  }

  .pin-wiring-guard-text {
    flex: 1;
    min-width: 0;
  }

  .pin-wiring-guard-text .field-description {
    margin: 0;
  }

  /* ─── ID reference picker option layout ──────────────────── */
  .id-option-stack {
    display: inline-flex;
    flex-direction: column;
    gap: 1px;
    line-height: 1.25;
  }

  /* Visually distinguish the "Add new …" entry at the bottom of
     the dropdown — same pattern as Home Assistant's entity
     pickers. Coloured to read as an action, not a value. */
  .id-option-add {
    border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    margin-top: var(--wa-space-2xs);
  }

  .id-option-add--solo {
    border-top: none;
    margin-top: 0;
  }

  .id-option-primary-add {
    color: var(--esphome-primary);
    font-weight: var(--wa-font-weight-bold);
  }

  .id-option-primary-add wa-icon {
    font-size: 14px;
  }

  .id-option-primary {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-normal);
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .id-option-secondary {
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
    font-style: italic;
  }

  .alert-entry {
    padding: var(--wa-space-s) var(--wa-space-m);
    background: var(--wa-color-surface-lowered);
    border-radius: var(--wa-border-radius-m);
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    line-height: 1.5;
  }

  .label-entry {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-subtle);
    font-style: italic;
  }

  .switch-field {
    display: grid;
    grid-template-columns: 1fr auto;
    column-gap: var(--wa-space-m);
    row-gap: var(--wa-space-2xs);
    align-items: center;
  }

  .switch-field .field-info {
    grid-column: 1;
    grid-row: 1 / span 2;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .switch-field > .help-button {
    grid-column: 2;
    grid-row: 1;
    margin-left: 0;
    align-self: start;
  }

  .switch-field > wa-switch {
    grid-column: 2;
    grid-row: 2;
    justify-self: end;
  }

  .switch-field:not(:has(> .help-button)) > wa-switch {
    grid-row: 1 / span 2;
  }

  wa-select {
    width: 100%;
  }

  .float-with-unit-inputs {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
  }

  .float-with-unit-inputs > input[type="number"] {
    flex: 1 1 auto;
    min-width: 0;
  }

  .float-with-unit-inputs > wa-select {
    flex: 0 0 auto;
    width: auto;
    min-width: 6rem;
  }

  /* Time-period field: numeric input + unit picker. Same layout
     as float_with_unit so the eye reads them as the same kind of
     compound control. */
  .time-period-inputs {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
  }

  .time-period-inputs > input {
    flex: 1 1 auto;
    min-width: 0;
  }

  .time-period-inputs > wa-select {
    flex: 0 0 auto;
    width: auto;
    min-width: 6rem;
  }

  .float-with-unit-suffix {
    flex: 0 0 auto;
    color: var(--wa-color-text-subtle);
    font-size: var(--wa-font-size-s);
  }

  /* Templatable field wrapper — column holding the literal/lambda tab
     strip (styled by literalLambdaToggleStyles) above the active
     body. */
  .templatable-field {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
  }

  /* TRIGGER (action-list) field — a button that opens the automation
     editor for the field's bare action list (cover open_action, …),
     since the actions can't be edited inline as a single value. */
  .edit-actions-button {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: var(--wa-space-2xs);
    padding: var(--wa-space-2xs) var(--wa-space-s);
    border: 1px solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-surface-raised, transparent);
    color: var(--wa-color-text-normal);
    font-family: inherit;
    font-size: var(--wa-font-size-s);
    cursor: pointer;
    transition: background 0.12s;
  }

  .edit-actions-button:hover:not(:disabled) {
    background: var(--wa-color-surface-lowered);
  }

  .edit-actions-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
