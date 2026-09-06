/** Nudge toward `ota: encryption:` for a device that already offers it; CTAs edit the draft only. */
import { consume } from "@lit/context";
import { mdiClose, mdiLockAlert } from "@mdi/js";
import { css, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { devicesContext, localizeContext, versionContext } from "../../context/index.js";
import { fireEvent } from "../../util/fire-event.js";
import {
  otaEncryptionNudge,
  type OtaEncryptionNudge,
} from "../../util/ota-encryption-nudge.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { renderNoticeBanner } from "./notice-banner.js";
import { noticeBannerStyles, noticeCloseStyles } from "./notice-banner.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ "lock-alert": mdiLockAlert, close: mdiClose });

@customElement("esphome-ota-encryption-notice")
export class ESPHomeOtaEncryptionNotice extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  @consume({ context: versionContext, subscribe: true })
  @state()
  private _esphomeVersion = "";

  @property() configuration = "";

  /** The page's draft buffer. */
  @property({ attribute: false }) yaml = "";

  @state() private _dismissed = false;

  /** Memoized so fleet events for other devices do not rescan the draft. */
  @state() private _nudge: OtaEncryptionNudge | null = null;

  private _device?: ConfiguredDevice;

  protected willUpdate(changed: PropertyValues) {
    if (changed.has("configuration")) this._dismissed = false;
    const device = this._devices.find((d) => d.configuration === this.configuration);
    const deviceChanged = device !== this._device;
    this._device = device;
    if (
      deviceChanged ||
      changed.has("yaml") ||
      changed.has("configuration") ||
      changed.has("_esphomeVersion")
    ) {
      this._nudge = otaEncryptionNudge({
        device,
        yaml: this.yaml,
        esphomeVersion: this._esphomeVersion,
      });
    }
  }

  static styles = [
    noticeBannerStyles,
    noticeCloseStyles,
    css`
      :host {
        display: block;
      }
    `,
  ];

  protected render() {
    const nudge = this._nudge;
    if (this._dismissed || !nudge) return nothing;
    const dropKey = nudge === "drop_own_key";
    return renderNoticeBanner({
      icon: "lock-alert",
      text: this._localize(`device.ota_encryption_notice_${nudge}`),
      ctaLabel: this._localize(
        dropKey ? "device.ota_encryption_use_api_key" : "device.ota_encryption_enable"
      ),
      onCta: () =>
        fireEvent(
          this,
          dropKey ? "request-drop-ota-encryption-key" : "request-enable-ota-encryption"
        ),
      dismissLabel: this._localize("device.ota_encryption_dismiss"),
      onDismiss: () => {
        this._dismissed = true;
      },
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-ota-encryption-notice": ESPHomeOtaEncryptionNotice;
  }
}
