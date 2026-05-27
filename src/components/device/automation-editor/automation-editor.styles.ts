import { css } from "lit";

/**
 * Shared styles for every sub-component in the automation-editor
 * package. Each sub-component pulls these in via its ``static
 * styles`` array so the panel layout, the section header rhythm,
 * the tree indentation, and the action-row buttons all stay in
 * lockstep across the package.
 */
export const automationEditorStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    /* Matches config-entry-form's :host gap so the editor's
       top-level rows (header, form, parameters, actions, …) sit
       at the same vertical rhythm as the catalog form's fields.
       Without this, the bespoke .field siblings render in a
       different cadence and the page reads as two different forms
       stitched together. */
    gap: var(--wa-space-m);
  }

  /* Component-style header card — at the top of the edit pane for
     automations and scripts. Mirrors the layout from
     device-board-info's section header so the editor reads as the
     "section editor" for an automation / script. */
  .ae-header {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: flex-start;
    gap: var(--wa-space-l);
    padding-bottom: var(--wa-space-m);
    /* The :host gap takes care of vertical spacing between the
       header and the next row, so the legacy margin-bottom would
       compound. Just keep the border + bottom padding so the
       divider line still reads as a section break. */
    border-bottom: 1px solid var(--wa-color-neutral-border-quiet, #e1e4e8);
  }

  .ae-header-text {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
    min-width: 0;
  }

  .ae-header-title {
    margin: 0;
    font-size: var(--wa-font-size-l);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  /* Section-type subtitle under the main header title. Kept for
     the script editor which renders the id as a subtitle below
     the static "Script" title. The automation editor doesn't use
     a subtitle anymore — its identity (target + trigger) is in
     the read-only form fields below the header. */
  .ae-header-subtitle {
    margin: 0;
    font-size: var(--wa-font-size-m);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-quiet);
  }

  /* Readonly inputs (target / trigger identity fields on the
     automation editor) read as form fields but the user can't
     edit them. Slightly different from the editable inputs:
     muted background + cursor: default to signal non-interactive. */
  input[readonly] {
    background: var(--wa-color-surface-lowered);
    cursor: default;
    color: var(--wa-color-text-quiet);
  }

  .ae-header-docs {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: var(--wa-color-brand-fill-loud, #0b5cad);
    font-size: var(--wa-font-size-2xs);
    text-decoration: none;
    align-self: flex-start;
  }

  .ae-header-docs:hover {
    text-decoration: underline;
  }

  .ae-header-docs wa-icon {
    font-size: 12px;
  }

  .ae-header-desc {
    margin: 0;
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    line-height: 1.5;
  }

  .ae-header-icon {
    flex: 0 0 auto;
    width: 64px;
    height: 64px;
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-surface-lowered);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .ae-header-icon wa-icon {
    font-size: 32px;
    color: var(--wa-color-brand-fill-loud, #0b5cad);
  }

  /* Component-catalog image (used for interval automations: we pull
     the parent component's image_url to give the same visual cue a
     user gets from a regular component editor). Sized to fit the
     64x64 slot without stretching pixel art. */
  .ae-header-icon img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  /* "Show advanced settings" toggle row — mirrors the device
     section-config layout so the eye reads the two surfaces as
     the same kind of form. */
  .advanced-toggle-row {
    display: flex;
    justify-content: flex-start;
    margin-top: var(--wa-space-s);
    font-size: var(--wa-font-size-s);
  }
  .advanced-toggle-row wa-switch {
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-quiet);
  }

  /* One titled panel — used for target, trigger, conditions, actions,
     and for any nested sub-panels inside a control-flow action. */
  .ae-section {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
    padding: var(--wa-space-m);
    border: 1px solid var(--wa-color-neutral-border-quiet, #e1e4e8);
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-surface-default);
  }

  .ae-section + .ae-section {
    margin-top: var(--wa-space-m);
  }

  .ae-section-label {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-normal);
  }

  /* Component-config-form-equivalent .field styles. Used in the
     script editor so the id / mode / parameters rows read the
     same as the regular component edit form (which uses
     config-entry-form.styles.ts's own .field family). Two
     separate style files because the scopes are different, but
     the visual contract is identical. */
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
  }

  /* No .field + .field margin: the :host above hands out
     --wa-space-m gap to every direct child via flex layout,
     so a sibling-adjacent rule would double up the spacing.
     Components that render the script editor inside a different
     container (e.g. tests, the legacy add-mode pane) just lose the
     between-field gap on those isolated cases — acceptable for now;
     the canonical mount path goes through the page which always
     gets the :host gap. */

  .field-label {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-normal);
    display: flex;
    align-items: center;
    gap: var(--wa-space-2xs);
  }

  .field-label .required {
    color: var(--esphome-error, #d92d20);
  }

  .field-description {
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
    margin: 0;
  }

  .field-description + input,
  .field-description + textarea,
  .field-description + wa-select {
    margin-top: 8px;
  }

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

  .ae-section-desc {
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
    margin: 0 0 var(--wa-space-2xs) 0;
  }

  .ae-muted {
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-2xs);
    margin-left: var(--wa-space-2xs);
  }

  .ae-row {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-s);
    padding: var(--wa-space-m);
    border: 1px solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-surface-raised);
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
  }

  .ae-row:hover {
    border-color: color-mix(in srgb, var(--wa-color-text-normal), transparent 80%);
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.03),
      0 2px 8px rgba(0, 0, 0, 0.04);
  }

  .ae-row.ae-row--collapsed {
    gap: 0;
    padding: var(--wa-space-xs) var(--wa-space-m);
  }

  .ae-row-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--wa-space-m);
    min-width: 0;
  }

  .ae-row-body {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-s);
    min-width: 0;
  }

  .ae-row-desc {
    margin: 0;
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    line-height: 1.5;
  }

  /* Each action / condition row lives inside its own custom
     element shadow, so .ae-row + .ae-row would never match — the
     rows aren't siblings in any one tree. The selector below
     targets where the elements ARE siblings (inside the
     action-list / condition-tree shadow), and that's exactly
     where the rule fires because the list/tree pulls in this same
     stylesheet. */
  esphome-automation-action-node + esphome-automation-action-node,
  esphome-automation-condition-node + esphome-automation-condition-node {
    margin-top: var(--wa-space-m);
    display: block;
  }

  .ae-row-picker {
    display: inline-flex;
    align-items: center;
    gap: var(--wa-space-2xs);
    appearance: none;
    background: transparent;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    color: var(--wa-color-text-normal);
    text-align: left;
    min-width: 0;
    font-family: inherit;
    transition: color 0.12s;
  }

  .ae-row-picker:hover:not(:disabled) {
    color: var(--wa-color-brand-fill-loud, #009fee);
  }

  .ae-row-picker:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .ae-row-picker-name {
    font-size: var(--wa-font-size-m);
    font-weight: var(--wa-font-weight-bold);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ae-row-picker wa-icon {
    color: var(--wa-color-text-quiet);
    font-size: 14px;
    flex: 0 0 auto;
    opacity: 0.7;
    transition:
      opacity 0.12s,
      color 0.12s;
  }

  .ae-row-picker:hover:not(:disabled) wa-icon {
    color: var(--wa-color-brand-fill-loud, #009fee);
    opacity: 1;
  }

  /* Horizontal toolbar living in the row header, opposite the
     title cluster. Was vertical when the layout was a 2-column
     grid; now the header is a single flex row, so a horizontal
     toolbar reads more naturally next to the title. */
  .ae-row-controls {
    display: flex;
    flex-direction: row;
    gap: 2px;
    align-items: center;
    flex: 0 0 auto;
  }

  /* Compact circular icon buttons matching the per-row edit/delete
     pattern used by the api-actions / automations tables in the
     section editor. The wa-icon child's font-size is left at its
     default so the glyph keeps the same size — only the hit-target
     shrinks and rounds around it. */
  .ae-row-controls button {
    appearance: none;
    border: 1px solid transparent;
    background: transparent;
    color: var(--wa-color-text-quiet);
    width: 26px;
    height: 26px;
    border-radius: 6px;
    cursor: pointer;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .ae-row-controls button:hover:not(:disabled) {
    background: var(--wa-color-surface-default);
    color: var(--wa-color-text-normal);
  }

  /* Destructive variant — same shape as siblings but a red-tinted
     hover wash + red glyph colour, mirroring the api-actions-row-
     delete treatment so destructive intent reads consistently
     across the app. */
  .ae-row-controls .ae-row-delete:hover:not(:disabled) {
    background: color-mix(in srgb, var(--esphome-error), transparent 90%);
    color: var(--esphome-error);
  }

  .ae-row-controls button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* Nested action list — indents children of a control-flow action
     so the tree structure reads at a glance. */
  .ae-nested {
    margin-top: var(--wa-space-s);
    margin-left: var(--wa-space-m);
    padding-left: var(--wa-space-m);
    border-left: 2px solid var(--wa-color-neutral-border-quiet, #e1e4e8);
  }

  .ae-nested-label {
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-quiet);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: var(--wa-space-2xs);
  }

  /* Add button — used at the bottom of every list. The default is
     a modest dashed affordance for nested lists (then/else inside
     an "if"). The top-level list (wrapped in .ae-section) gets
     the prominent overlay below — that's the primary "Add action"
     / "Add condition" the user reaches for from a fresh
     automation, so it should pop. */
  /* Bespoke value + unit picker the Delay action uses instead of
     its six separate time-component string inputs. Keeps the user
     in the same "one knob" mental model as the interval form
     (which is a single time_period string). */
  .ae-delay-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--wa-space-m);
  }
  .ae-delay-row .field-label {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-normal);
    margin-bottom: var(--wa-space-2xs);
    display: block;
  }
  .ae-delay-row input,
  .ae-delay-row select {
    width: 100%;
    padding: var(--wa-space-2xs) var(--wa-space-s);
    border: 1px solid var(--wa-color-neutral-border-quiet, #d1d5db);
    border-radius: var(--wa-border-radius-s);
    background: var(--wa-color-surface-default);
    font-size: var(--wa-font-size-s);
    box-sizing: border-box;
  }

  .ae-add {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: var(--wa-space-2xs);
    width: 100%;
    appearance: none;
    border: 1px solid var(--wa-color-brand-fill-loud, #009fee);
    background: var(--esphome-primary-light);
    color: var(--wa-color-brand-fill-loud, #009fee);
    padding: var(--wa-space-s) var(--wa-space-m);
    border-radius: var(--wa-border-radius-m);
    cursor: pointer;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    margin-top: var(--wa-space-s);
    transition:
      background 0.12s,
      border-color 0.12s,
      color 0.12s;
  }

  .ae-add:hover:not(:disabled) {
    background: color-mix(
      in srgb,
      var(--wa-color-brand-fill-loud, #009fee) 18%,
      transparent
    );
  }

  .ae-add:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Nested add buttons (inside then / else / while / repeat) —
     dashed, quiet so the eye reads the prominent outer button as
     the primary CTA. :host-context() reaches across the
     action-list's shadow boundary into the parent action-node's
     .ae-nested wrapper, which is the only way a sibling
     custom-element with its own shadow can scope the rule. They
     still pick up the brand color on hover for affordance. */
  :host-context(.ae-nested) .ae-add {
    border: 1px dashed var(--wa-color-neutral-border-quiet, #d1d5db);
    color: var(--wa-color-text-quiet);
    padding: var(--wa-space-2xs) var(--wa-space-s);
    font-size: var(--wa-font-size-2xs);
    margin-top: var(--wa-space-2xs);
  }

  :host-context(.ae-nested) .ae-add:hover:not(:disabled) {
    border-color: var(--wa-color-brand-fill-loud, #0b5cad);
    color: var(--wa-color-brand-fill-loud, #0b5cad);
    background: transparent;
  }

  .ae-error {
    color: var(--esphome-error, #d92d20);
    font-size: var(--wa-font-size-2xs);
    margin-top: var(--wa-space-2xs);
  }

  .ae-empty {
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
    font-style: italic;
  }

  .ae-actions-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--wa-space-s);
  }

  .ae-section-add {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    background: var(--wa-color-brand-fill-loud, #009fee);
    color: var(--wa-color-brand-on-loud, #ffffff);
    border: var(--wa-border-width-s) solid var(--wa-color-brand-fill-loud, #009fee);
    padding: 2px var(--wa-space-s);
    border-radius: var(--wa-border-radius-m);
    cursor: pointer;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-semibold);
    font-family: inherit;
    transition:
      background 0.12s,
      border-color 0.12s;
  }

  .ae-section-add:hover:not(:disabled) {
    background: color-mix(in srgb, var(--wa-color-brand-fill-loud, #009fee), black 10%);
    border-color: color-mix(in srgb, var(--wa-color-brand-fill-loud, #009fee), black 10%);
  }

  .ae-section-add:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .ae-section-add wa-icon {
    font-size: 14px;
  }

  .ae-empty-block {
    margin: 0;
    padding: var(--wa-space-m) var(--wa-space-s);
    text-align: center;
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-s);
    font-style: italic;
    border: 1px dashed var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-surface-lowered, transparent);
  }

  /* Bottom-of-editor save / delete buttons. */
  .ae-actions {
    display: flex;
    gap: var(--wa-space-s);
    margin-top: var(--wa-space-m);
    justify-content: flex-end;
  }

  .ae-actions button {
    display: inline-flex;
    align-items: center;
    gap: var(--wa-space-2xs);
    appearance: none;
    border: 1px solid transparent;
    padding: var(--wa-space-2xs) var(--wa-space-m);
    border-radius: var(--wa-border-radius-s);
    cursor: pointer;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
  }

  .ae-actions .ae-primary {
    background: var(--wa-color-brand-fill-loud, #0b5cad);
    color: white;
  }

  .ae-actions .ae-primary:hover:not(:disabled) {
    filter: brightness(1.05);
  }

  .ae-actions .ae-danger {
    gap: 4px;
    background: #e54d2e;
    color: #ffffff;
    border: var(--wa-border-width-s) solid #e54d2e;
    padding: var(--wa-space-xs) var(--wa-space-m);
    border-radius: var(--wa-border-radius-m);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    transition:
      background 0.12s,
      border-color 0.12s;
  }

  .ae-actions .ae-danger:hover:not(:disabled) {
    background: color-mix(in srgb, #e54d2e, black 10%);
    border-color: color-mix(in srgb, #e54d2e, black 10%);
  }

  .ae-actions .ae-danger wa-icon {
    font-size: 16px;
  }

  .ae-actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
