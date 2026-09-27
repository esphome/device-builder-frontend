/**
 * Intermediate base for the two trigger-less (callable) editors —
 * script and api-action. Owns the mount-time catalog load the
 * automation editor diverges from.
 */
import { type CSSResultGroup, html } from "lit";

import type { AutomationLocation } from "../../../api/types/automations.js";
import { getErrorMessage } from "../../../util/error-message.js";
import { renderMarkdown } from "../../../util/markdown.js";
import { scrollFlashRow } from "../field-highlight.js";
import { fieldHighlightStyles } from "../field-highlight.styles.js";
import { entryFieldFocus, focusKey } from "./automation-focus.js";
import { BaseAutomationEditor } from "./base-editor.js";

export abstract class CallableAutomationEditor<
  L extends AutomationLocation,
> extends BaseAutomationEditor<L> {
  static styles: CSSResultGroup = [BaseAutomationEditor.styles, fieldHighlightStyles];

  /** Target already name-flashed, one shot each. It names the callable
   *  on screen as well as the caret's place: that place reads the same
   *  in every script. */
  private _nameFlashKey?: string;

  /** ``id`` of the name input, which its label points at. */
  protected abstract readonly _nameInputId: string;

  /** YAML keys that hold the name; the caret on one flashes the field. */
  protected abstract readonly _nameYamlKeys: readonly string[];

  protected override updated(changed: Map<string, unknown>) {
    this._maybeFlashName();
    super.updated(changed);
  }

  /**
   * The field that names the callable: a script's id, an API action's
   * name. Locked, since the YAML splice destination is keyed by it: a
   * rename would move the entry to a different slot, and the backend has
   * no rename. ``readonly`` rather than ``disabled`` so the value stays
   * focusable and selectable for copy and screen readers; ``disabled``
   * is reserved for the during-delete state where the whole editor is
   * inert.
   */
  protected _renderNameField(
    field: { label: string; description: string; value: string },
    disabled: boolean
  ) {
    return html`<div class="field">
      <label class="field-label" for=${this._nameInputId}>${field.label}</label>
      <p class="field-description">${renderMarkdown(field.description)}</p>
      <input
        id=${this._nameInputId}
        type="text"
        .value=${field.value}
        ?disabled=${disabled}
        readonly
      />
    </div>`;
  }

  /** The name lives in a bespoke input, outside any form — flash its
   *  field when the cursor targets one of its YAML keys. */
  private _maybeFlashName(): void {
    const focus = this._currentFocus();
    const head = entryFieldFocus(focus)?.[0];
    if (head === undefined || !this._nameYamlKeys.includes(head)) return;
    const key = `${this._target}:${focusKey(focus)}`;
    if (key === this._nameFlashKey) return;
    const field = this.shadowRoot
      ?.querySelector(`#${this._nameInputId}`)
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
