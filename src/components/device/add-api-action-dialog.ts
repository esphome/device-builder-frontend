/**
 * "+ Add API action" wizard dialog.
 *
 * Parallels the add-script wizard: ask only for the action name,
 * save an empty ``AutomationTree`` to the backend, then close and
 * route the navigator to the new section so the user lands in the
 * inline api-action editor (where variables and actions get filled
 * in).
 *
 * Emits ``automation-added`` on success so the parent can route the
 * navigator to the new ``automation:api_action:<name>`` section.
 */
import { consume } from "@lit/context";
import { mdiClose } from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { notifyError } from "../../util/notify.js";

import type { ESPHomeAPI } from "../../api/index.js";
import type { AutomationLocation, AutomationTree } from "../../api/types/automations.js";
import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import { normalizeEspHomeId } from "../../util/esphome-id.js";
import { renderMarkdown } from "../../util/markdown.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { parseYamlAutomations } from "../../util/yaml-sections.js";
import { applyYamlDiff, sectionKeyFromLocation } from "./automation-editor/serialise.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../base-dialog.js";

registerMdiIcons({ close: mdiClose });

@customElement("esphome-add-api-action-dialog")
export class ESPHomeAddApiActionDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @property() boardName = "";

  @property() configuration = "";

  @property() yaml = "";

  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  @state() private _open = false;
  @state() private _name = "";
  @state() private _saving = false;
  @state() private _error = "";

  static styles = [
    espHomeStyles,
    inputStyles,
    css`
      esphome-base-dialog {
        --width: 480px;
      }
      esphome-base-dialog::part(body) {
        padding: var(--wa-space-l);
      }
      .intro {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        margin: 0 0 var(--wa-space-m) 0;
        line-height: 1.5;
      }
      .intro code {
        font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
        font-size: var(--wa-font-size-2xs);
        padding: 1px 4px;
        border-radius: var(--wa-border-radius-s);
        background: var(--wa-color-surface-lowered);
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
      }
      .field-label {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-semibold);
        color: var(--wa-color-text-normal);
      }
      .required {
        color: var(--esphome-error, #d92d20);
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        margin-top: var(--wa-space-l);
      }

      .actions button {
        display: inline-flex;
        align-items: center;
        box-sizing: border-box;
        gap: 3px;
        padding: 7px 14px;
        border: var(--wa-border-width-s) solid transparent;
        border-radius: var(--wa-border-radius-m);
        cursor: pointer;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        line-height: 1;
        transition:
          background 0.12s,
          border-color 0.12s,
          box-shadow 0.12s,
          transform 0.12s;
      }
      .actions .primary {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
        box-shadow: var(--esphome-primary-shadow);
      }
      .actions .primary:hover:not(:disabled) {
        background: var(--esphome-primary-hover);
        box-shadow: var(--esphome-primary-shadow-hover);
        transform: translateY(-1px);
      }
      .actions .primary:active:not(:disabled) {
        transform: translateY(0);
      }
      .actions .primary:disabled {
        background: color-mix(
          in srgb,
          var(--esphome-primary) 35%,
          var(--wa-color-surface-default)
        );
        color: color-mix(in srgb, var(--esphome-on-primary), transparent 30%);
        cursor: not-allowed;
        box-shadow: none;
        transform: none;
      }
      .error {
        color: var(--esphome-error, #d92d20);
        font-size: var(--wa-font-size-2xs);
        margin-top: var(--wa-space-2xs);
      }
    `,
  ];

  public open() {
    this._name = "";
    this._error = "";
    this._open = true;
  }

  // esphome-base-dialog never mutates its own open on a user-driven close
  // (Escape / X / backdrop); the host owns flipping _open here, else a
  // re-render re-asserts ?open and the dialog can't dismiss.
  private _onRequestClose = (): void => {
    this._open = false;
  };

  protected render() {
    const title = this.boardName
      ? this._localize("device.add_api_action_dialog_title", {
          name: this.boardName,
        })
      : this._localize("device.add_api_action");
    return html`<esphome-base-dialog
      ?open=${this._open}
      ?busy=${this._saving}
      .label=${title}
      .confirmOnEnter=${this._onContinue}
      @request-close=${this._onRequestClose}
    >
      <p class="intro">
        ${renderMarkdown(this._localize("device.api_action_header_description"))}
      </p>
      <div class="field">
        <label class="field-label" for="api-action-id-input">
          ${this._localize("device.automation_target_api_action_new_id_label")}
          <span class="required">*</span>
        </label>
        <input
          id="api-action-id-input"
          type="text"
          .value=${this._name}
          placeholder=${this._localize(
            "device.automation_target_api_action_id_placeholder"
          )}
          ?disabled=${this._saving}
          @input=${(e: Event) => {
            this._name = normalizeEspHomeId((e.target as HTMLInputElement).value);
            this._error = "";
          }}
        />
      </div>
      ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
      <div class="actions">
        <button
          type="button"
          class="primary"
          ?disabled=${this._saving || !this._canContinue()}
          @click=${this._onContinue}
        >
          ${
            this._saving
              ? this._localize("device.adding")
              : this._localize("device.add_automation_continue")
          }
        </button>
      </div>
    </esphome-base-dialog>`;
  }

  private _canContinue(): boolean {
    if (!this._name) return false;
    // Don't allow names that collide with an existing api_action in
    // the current draft YAML. Backend would reject the upsert, but
    // catching it here gives instant feedback without a round-trip.
    const taken = parseYamlAutomations(this.yaml).some(
      (s) => s.key === `automation:api_action:${this._name}`
    );
    return !taken;
  }

  private _onContinue = async () => {
    if (!this._api || !this._canContinue() || this._saving) return;
    this._saving = true;
    this._error = "";
    try {
      const location: AutomationLocation = {
        kind: "api_action",
        action_name: this._name,
      };
      const tree: AutomationTree = {
        trigger_id: null,
        trigger_params: {},
        actions: [],
      };
      const { yaml_diff } = await this._api.upsertAutomation(
        this.configuration,
        tree,
        location,
        this.yaml
      );
      const newYaml = applyYamlDiff(this.yaml, yaml_diff);
      this.dispatchEvent(
        new CustomEvent<{ yaml: string }>("yaml-draft", {
          detail: { yaml: newYaml },
          bubbles: true,
          composed: true,
        })
      );
      this.dispatchEvent(
        new CustomEvent<{ sectionKey: string }>("automation-added", {
          detail: { sectionKey: sectionKeyFromLocation(location) },
          bubbles: true,
          composed: true,
        })
      );
      this._open = false;
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : this._localize("device.automation_save_error");
      this._error = msg;
      notifyError(this._localize("device.automation_save_error"), {
        description: msg,
      });
    } finally {
      this._saving = false;
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-add-api-action-dialog": ESPHomeAddApiActionDialog;
  }
}
