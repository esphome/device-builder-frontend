import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import "../../components/base-dialog.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import {
  downloadBuildParts,
  fetchEsphomeWebManifest,
  selectBuild,
} from "../util/esphome-web-firmware.js";
import { InstallFlowController } from "./install-flow-controller.js";
import { renderInstallProgress } from "./install-progress.js";

import "@home-assistant/webawesome/dist/components/button/button.js";
import "@home-assistant/webawesome/dist/components/checkbox/checkbox.js";

/**
 * "Prepare for first use": flash the prebuilt esphome-web firmware fetched
 * from firmware.esphome.io, then hand off to Wi-Fi provisioning (Improv). The
 * device then shows up on the user's ESPHome Device Builder ready to adopt.
 */
@customElement("esphome-web-install-adoptable-dialog")
export class ESPHomeWebInstallAdoptableDialog extends LitElement {
  @property({ attribute: false }) port!: SerialPort;
  @property({ type: Boolean }) open = false;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  private _flow = new InstallFlowController(this);

  // Erase the whole flash before writing. Off by default: the factory image
  // alone is enough for a fresh board, and erasing costs extra time. On a
  // board that ran something before, leftover NVS (old Wi-Fi credentials, an
  // AP password) survives a plain write, so the new firmware may come up
  // already "provisioned" and skip the Wi-Fi scan; erasing fixes that.
  @state() private _erase = false;

  private async _install(): Promise<void> {
    await this._flow.start(this.port, {
      erase: this._erase,
      filesCallback: async (chipFamily) => {
        const manifest = await fetchEsphomeWebManifest();
        const build = selectBuild(manifest, chipFamily);
        if (!build) {
          throw new Error(
            this._localize("web.install.unsupported_chip", { chip: chipFamily })
          );
        }
        return downloadBuildParts(build);
      },
      messages: {
        connectFailed: this._localize("web.install.connect_failed_hint"),
        noFirmware: this._localize("web.install.no_firmware"),
      },
    });
    // On success the dialog stays in its "done" state showing the Continue
    // button (see render). We do NOT auto-open Improv here: this dialog is a
    // native modal, and appending the Improv dialog while it's still open would
    // leave Improv inert behind the backdrop. The hand-off happens on Continue,
    // once the parent has closed this dialog.
  }

  // Continue → tell the parent to close this dialog and open Improv Wi-Fi
  // provisioning on the (now reset) device.
  private _continue(): void {
    this.dispatchEvent(
      new CustomEvent("provision-wifi", { bubbles: true, composed: true })
    );
  }

  private _onAfterHide(): void {
    this._flow.reset();
    this._erase = false;
    this.dispatchEvent(new CustomEvent("after-hide", { bubbles: true }));
  }

  private _renderSetup() {
    return html`
      <p>${this._localize("web.install.adoptable_intro")}</p>
      <p>${this._localize("web.install.adoptable_detail")}</p>
      <div class="erase-row">
        <wa-checkbox
          .checked=${this._erase}
          @change=${(e: Event) => {
            this._erase = (e.target as HTMLInputElement).checked;
          }}
          >${this._localize("web.install.adoptable_erase")}</wa-checkbox
        >
        <span class="helper"
          >${this._localize("web.install.adoptable_erase_helper")}</span
        >
      </div>
    `;
  }

  protected render() {
    const inProgress = this._flow.step !== "idle";
    return html`
      <esphome-base-dialog
        .label=${this._localize("web.install.adoptable_title")}
        ?open=${this.open}
        ?busy=${this._flow.busy}
        @after-hide=${this._onAfterHide}
      >
        ${
          inProgress
            ? renderInstallProgress(this._flow, this._localize)
            : this._renderSetup()
        }
        ${
          this._flow.done
            ? html`<p class="done">${this._localize("web.install.adoptable_done")}</p>`
            : nothing
        }
        <div class="actions">
          ${
            this._flow.done
              ? html`<wa-button variant="brand" @click=${this._continue}>
                  ${this._localize("onboarding.wizard.continue")}
                </wa-button>`
              : html`<wa-button
                  variant="brand"
                  ?disabled=${this._flow.busy}
                  @click=${this._install}
                >
                  ${this._localize("dashboard.install")}
                </wa-button>`
          }
        </div>
      </esphome-base-dialog>
    `;
  }

  static styles = [
    espHomeStyles,
    css`
      .done {
        color: var(--esphome-success);
        font-weight: var(--wa-font-weight-semibold);
      }
      .erase-row {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
        margin-top: var(--wa-space-m);
      }
      .helper {
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        margin-top: var(--wa-space-m);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-install-adoptable-dialog": ESPHomeWebInstallAdoptableDialog;
  }
}
