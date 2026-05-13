/**
 * "Add automation" dialog — thin wrapper around
 * ``<esphome-automation-editor>`` in add-mode (no ``value``, no
 * ``location`` until the user picks a target).
 *
 * The earlier skeleton kept its own catalog state and form fields;
 * now the editor owns target / trigger / conditions / actions
 * pickers and reports back via the ``automation-save`` event. The
 * dialog's only jobs are mounting the editor, applying the returned
 * ``YamlDiff`` to the device's YAML, and closing.
 */
import { consume } from "@lit/context";
import { mdiClose } from "@mdi/js";
import { css, html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";

import type { BoardCatalogEntry, YamlDiff } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./automation-editor/automation-editor.js";

registerMdiIcons({ close: mdiClose });

@customElement("esphome-add-automation-dialog")
export class ESPHomeAddAutomationDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property() boardName = "";

  @property() configuration = "";

  @property() yaml = "";

  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  static styles = [
    espHomeStyles,
    css`
      wa-dialog {
        --width: 720px;
      }
      wa-dialog::part(body) {
        padding: var(--wa-space-l);
      }
    `,
  ];

  public open() {
    this._dialog.open = true;
  }

  protected render() {
    return html`<wa-dialog
      light-dismiss
      label=${this.boardName
        ? this._localize("device.add_automation_dialog_title", {
            name: this.boardName,
          })
        : this._localize("device.add_automation")}
    >
      <esphome-automation-editor
        .configuration=${this.configuration}
        .board=${this.board}
        .platform=${this.board?.esphome.platform ?? ""}
        .yaml=${this.yaml}
        @automation-save=${this._onSave}
      ></esphome-automation-editor>
    </wa-dialog>`;
  }

  private _onSave = (e: CustomEvent<{ yamlDiff: YamlDiff }>) => {
    // Forward the splice to the page so it patches the YAML buffer
    // through the same path component edits use; the dialog only
    // signals success and dismisses.
    this.dispatchEvent(
      new CustomEvent("automation-yaml-diff", {
        detail: { yamlDiff: e.detail.yamlDiff },
        bubbles: true,
        composed: true,
      }),
    );
    this._dialog.open = false;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-add-automation-dialog": ESPHomeAddAutomationDialog;
  }
}
