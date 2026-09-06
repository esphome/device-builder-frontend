/**
 * Nudge shown when a device already offers OTA encryption with its API
 * key (released 2026.9.0+ firmware, Noise reported on the wire) but the
 * config does not yet require it. The CTA adds a bare `encryption:` to
 * the esphome OTA platform in the draft and drops any `password:`; the
 * gates live in `ota-encryption-nudge.ts` so a device that cannot offer
 * Noise is never pointed at a block that would lock it out of OTA.
 */
import { consume } from "@lit/context";
import { mdiClose, mdiLockAlert } from "@mdi/js";
import { css, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { devicesContext, localizeContext, versionContext } from "../../context/index.js";
import { fireEvent } from "../../util/fire-event.js";
import { otaEncryptionNudge } from "../../util/ota-encryption-nudge.js";
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

  protected willUpdate(changed: PropertyValues) {
    if (changed.has("configuration")) this._dismissed = false;
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
    if (this._dismissed) return nothing;
    const nudge = otaEncryptionNudge({
      device: this._devices.find((d) => d.configuration === this.configuration),
      yaml: this.yaml,
      esphomeVersion: this._esphomeVersion,
    });
    if (!nudge) return nothing;
    return renderNoticeBanner({
      icon: "lock-alert",
      text: this._localize(`device.ota_encryption_notice_${nudge}`),
      ctaLabel: this._localize("device.ota_encryption_enable"),
      onCta: () => fireEvent(this, "request-enable-ota-encryption"),
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
