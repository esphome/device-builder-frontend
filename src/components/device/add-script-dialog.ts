/**
 * "+ Add script" wizard dialog.
 *
 * Parallels the add-automation wizard: ask the bare minimum (the
 * script's ``id``), save an empty ``AutomationTree`` to the
 * backend, then close and route the navigator to the new section
 * so the user lands in the inline script editor (where run mode,
 * parameters, and actions get filled in).
 *
 * The script editor is then responsible for the rest — that's
 * where the user gets full-width space to add actions, instead of
 * the dialog's 560px clamp.
 *
 * Emits ``automation-added`` on success so the parent can route
 * the navigator to the new ``automation:script:<id>`` section.
 */
import { consume } from "@lit/context";
import { mdiClose } from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import toast from "sonner-js";

import type { ESPHomeAPI } from "../../api/index.js";
import type {
  AutomationLocation,
  AutomationTree,
  AvailableAutomations,
  BoardCatalogEntry,
} from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import { normalizeEspHomeId } from "../../util/esphome-id.js";
import { renderMarkdown } from "../../util/markdown.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { applyYamlDiff, sectionKeyFromLocation } from "./automation-editor/serialise.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ close: mdiClose });

@customElement("esphome-add-script-dialog")
export class ESPHomeAddScriptDialog extends LitElement {
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

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  @state() private _id = "";
  @state() private _available: AvailableAutomations | null = null;
  @state() private _saving = false;
  @state() private _error = "";

  static styles = [
    espHomeStyles,
    inputStyles,
    css`
      wa-dialog {
        --width: 480px;
      }
      wa-dialog::part(body) {
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
        box-shadow: 0 2px 8px color-mix(in srgb, var(--esphome-primary), transparent 50%);
      }
      .actions .primary:hover:not(:disabled) {
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
        box-shadow: 0 4px 14px color-mix(in srgb, var(--esphome-primary), transparent 35%);
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
    this._id = "";
    this._error = "";
    this._dialog.open = true;
    void this._loadAvailable();
  }

  private async _loadAvailable() {
    if (!this._api || !this.configuration) return;
    try {
      this._available = await this._api.getAvailableAutomations(this.configuration);
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    }
  }

  protected render() {
    const title = this.boardName
      ? this._localize("device.add_script_dialog_title", {
          name: this.boardName,
        })
      : this._localize("device.add_script");
    return html`<wa-dialog light-dismiss label=${title}>
      <p class="intro">
        ${renderMarkdown(this._localize("device.script_header_description"))}
      </p>
      <div class="field">
        <label class="field-label" for="script-id-input">
          ${this._localize("device.automation_target_script_new_id_label")}
          <span class="required">*</span>
        </label>
        <input
          id="script-id-input"
          type="text"
          .value=${this._id}
          placeholder=${this._localize("device.automation_target_script_id_placeholder")}
          ?disabled=${this._saving}
          @input=${(e: Event) => {
            this._id = normalizeEspHomeId((e.target as HTMLInputElement).value);
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
          ${this._saving
            ? this._localize("device.adding")
            : this._localize("device.add_automation_continue")}
        </button>
      </div>
    </wa-dialog>`;
  }

  private _canContinue(): boolean {
    if (!this._id) return false;
    // Don't allow ids that collide with existing scripts.
    return !this._available?.scripts.some((s) => s.id === this._id);
  }

  private _onContinue = async () => {
    if (!this._api || !this._canContinue() || this._saving) return;
    this._saving = true;
    this._error = "";
    try {
      const location: AutomationLocation = { kind: "script", id: this._id };
      const tree: AutomationTree = {
        trigger_id: null,
        // Default the script's run mode to ``single`` — that's the
        // ESPHome default if you omit ``mode:`` from the YAML. The
        // script editor lets the user change it after creation.
        trigger_params: { mode: "single" },
        actions: [],
      };
      // Hand the backend our current draft yaml so the splice
      // lands relative to any pending edits the user hasn't saved
      // yet — matches the auto-apply path in the editor.
      const { yaml_diff } = await this._api.upsertAutomation(
        this.configuration,
        tree,
        location,
        this.yaml
      );
      // Apply the diff to the page's YAML so the new script
      // lands in ``_yaml`` and the global save button activates.
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
      this._dialog.open = false;
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : this._localize("device.automation_save_error");
      this._error = msg;
      toast.error(this._localize("device.automation_save_error"), {
        description: msg,
        richColors: true,
      });
    } finally {
      this._saving = false;
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-add-script-dialog": ESPHomeAddScriptDialog;
  }
}
