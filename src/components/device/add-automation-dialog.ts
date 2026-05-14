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

import type {
  AutomationLocation,
  BoardCatalogEntry,
  YamlDiff,
} from "../../api/types.js";
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

  /**
   * Seed location for the embedded editor. Reset on every ``open()``
   * call so a dialog reused across "+ Add automation" and "+ Add
   * script" clicks doesn't carry the previous kind forward.
   *
   * ``device_on`` is the default for automation mode — matches the
   * target picker's visual default. ``script`` mode is set by the
   * "+ Add script" handler in the navigator.
   */
  @state()
  private _initialLocation: AutomationLocation = {
    kind: "device_on",
    trigger: "on_boot",
  };

  /** Bump on every ``open()`` so the embedded editor re-mounts with
   *  a fresh state — otherwise wa-dialog keeps the previous one
   *  alive and add-mode for script after add-mode for automation
   *  would inherit the prior session. */
  @state()
  private _instanceId = 0;

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

  /**
   * Open the dialog. Pass ``"script"`` to seed the editor with a
   * blank script declaration (id input + mode + body); the default
   * (``"automation"``) opens with a ``device_on`` target — what the
   * "+ Add automation" button uses.
   */
  public open(kind: "automation" | "script" = "automation") {
    this._initialLocation =
      kind === "script"
        ? { kind: "script", id: "" }
        : { kind: "device_on", trigger: "on_boot" };
    this._instanceId += 1;
    this._dialog.open = true;
  }

  protected render() {
    const isScript = this._initialLocation.kind === "script";
    const title = isScript
      ? this.boardName
        ? this._localize("device.add_script_dialog_title", {
            name: this.boardName,
          })
        : this._localize("device.add_script")
      : this.boardName
        ? this._localize("device.add_automation_dialog_title", {
            name: this.boardName,
          })
        : this._localize("device.add_automation");
    return html`<wa-dialog light-dismiss label=${title}>
      ${this._renderEditor(this._instanceId)}
    </wa-dialog>`;
  }

  /**
   * Render the editor keyed by ``_instanceId`` so each ``open()``
   * call produces a fresh element. Reusing the same element across
   * opens would carry the previous session's catalog cache and
   * editor state — confusing when switching from "+ Add automation"
   * to "+ Add script" or vice versa.
   */
  private _renderEditor(instanceId: number) {
    // The element id changes per open so Lit treats it as a new
    // template node (no patch — fresh mount).
    return html`<esphome-automation-editor
      id="editor-${instanceId}"
      add-mode
      .configuration=${this.configuration}
      .board=${this.board}
      .platform=${this.board?.esphome.platform ?? ""}
      .yaml=${this.yaml}
      .location=${this._initialLocation}
      @automation-save=${this._onSave}
    ></esphome-automation-editor>`;
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
