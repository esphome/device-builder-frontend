/**
 * Intermediate base for the two trigger-less (callable) editors —
 * script and api-action. Owns the mount-time catalog load the
 * automation editor diverges from.
 */
import { type CSSResultGroup, html, nothing } from "lit";

import type { AutomationLocation } from "../../../api/types/automations.js";
import { getErrorMessage } from "../../../util/error-message.js";
import { renderMarkdown } from "../../../util/markdown.js";
import { scrollFlashRow } from "../field-highlight.js";
import { fieldHighlightStyles } from "../field-highlight.styles.js";
import { entryFieldFocus, focusKey } from "./automation-focus.js";
import { BaseAutomationEditor } from "./base-editor.js";

/** The field that names a callable: a script's id, an API action's name. */
export interface CallableNameField {
  /** ``id`` of the input, which the label points at. */
  inputId: string;
  /** YAML keys that hold the name; the caret on one flashes the field. */
  yamlKeys: readonly string[];
  label: string;
  description: string;
  value: string;
  /** Called with what the user typed while adding; the field cannot be
   *  typed into without it. */
  onInput?: (value: string) => void;
}

export abstract class CallableAutomationEditor<
  L extends AutomationLocation,
> extends BaseAutomationEditor<L> {
  static styles: CSSResultGroup = [BaseAutomationEditor.styles, fieldHighlightStyles];

  /** ``focusKey`` already name-flashed — one-shot per target. */
  private _nameFlashKey?: string;

  protected abstract _nameField(): CallableNameField;

  protected override updated(changed: Map<string, unknown>) {
    this._maybeFlashName();
    super.updated(changed);
  }

  /**
   * The name input. Locked in edit mode so the YAML splice destination
   * stays pinned: a rename would move the entry to a different slot, and
   * the backend has no rename. ``readonly`` rather than ``disabled`` for
   * the lock so the value stays focusable and selectable for copy and
   * screen readers; ``disabled`` is reserved for the during-delete state
   * where the whole editor is inert.
   */
  protected _renderNameField(disabled: boolean) {
    const field = this._nameField();
    const { onInput } = field;
    return html`<div class="field">
      <label class="field-label" for=${field.inputId}>${field.label}</label>
      <p class="field-description">${renderMarkdown(field.description)}</p>
      <input
        id=${field.inputId}
        type="text"
        .value=${field.value}
        ?disabled=${disabled}
        ?readonly=${!this.addMode || !onInput}
        @input=${
          onInput ? (e: Event) => onInput((e.target as HTMLInputElement).value) : nothing
        }
      />
    </div>`;
  }

  /** The name lives in a bespoke input, outside any form — flash its
   *  field when the cursor targets one of its YAML keys. */
  private _maybeFlashName(): void {
    const { inputId, yamlKeys } = this._nameField();
    const focus = this._currentFocus();
    const head = entryFieldFocus(focus)?.[0];
    if (head === undefined || !yamlKeys.includes(head)) return;
    const key = focusKey(focus);
    if (key === this._nameFlashKey) return;
    const field = this.shadowRoot
      ?.querySelector(`#${inputId}`)
      ?.closest<HTMLElement>(".field");
    // Hold the shot while the loading spinner still owns the render.
    if (!field) return;
    this._nameFlashKey = key;
    scrollFlashRow(field);
  }

  connectedCallback(): void {
    super.connectedCallback();
    void this._load();
  }

  protected async _load() {
    if (!this._api) return;
    this._loading = true;
    this._error = "";
    try {
      if (this.configuration) await this._loadAvailable();
    } catch (err) {
      this._error = getErrorMessage(err);
    } finally {
      this._loading = false;
    }
  }

  protected async _loadAvailable() {
    // Hydrates config_entries (the slim catalog omits them); without
    // it every action renders fieldless since the node bails on an
    // empty config_entries list.
    this._error = "";
    const { available, error } = await this._catalogLoad.load(
      this._api,
      this.configuration,
      this._localize
    );
    if (error !== undefined) this._error = error;
    if (available) this._available = available;
  }
}
