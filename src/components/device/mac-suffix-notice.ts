/**
 * Warning nudge shown when the config keeps `name_add_mac_suffix: true`:
 * the device then announces itself as `<name>-<suffix>`, which never
 * matches this config, so its online status can't be tracked. The
 * option is a provisioning feature; the CTA rewrites the flag to
 * `false` in the draft (the device keeps its suffixed hostname until
 * the next install). Detection is a pure line scan of the buffer — no
 * backend round-trip — so a flag the scan can't see (an `esphome:`
 * block pulled in via `packages:`, a substituted value) falls back to
 * the backend-resolved device flag and renders without the CTA: the
 * rewrite can only fix a literal in the local buffer.
 */
import { consume } from "@lit/context";
import { mdiAlertOutline, mdiClose } from "@mdi/js";
import { css, html, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { devicesContext, localizeContext } from "../../context/index.js";
import { fireEvent } from "../../util/fire-event.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { MAC_SUFFIX_DOCS_URL } from "../../util/troubleshoot-tree.js";
import {
  findTruthyMacSuffixLine,
  macSuffixDisabledInDraft,
} from "../../util/yaml-mac-suffix.js";
import { renderNoticeBanner } from "./notice-banner.js";
import { noticeBannerStyles, noticeCloseStyles } from "./notice-banner.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ "alert-outline": mdiAlertOutline, close: mdiClose });

@customElement("esphome-mac-suffix-notice")
export class ESPHomeMacSuffixNotice extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

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
      a {
        color: inherit;
      }
    `,
  ];

  protected render() {
    if (this._dismissed) return nothing;
    const editable = findTruthyMacSuffixLine(this.yaml) >= 0;
    if (!editable) {
      // A draft that explicitly disables the flag wins over the backend
      // flag, which lags until save — clicking "Turn off" must clear
      // the banner immediately. Everything else the scan can't parse
      // (packages, substituted values) defers to the backend.
      const flagged =
        this._devices.find((d) => d.configuration === this.configuration)
          ?.name_add_mac_suffix === true;
      if (macSuffixDisabledInDraft(this.yaml) || !flagged) return nothing;
    }
    const base = {
      icon: "alert-outline",
      text: html`${this._localize("device.mac_suffix_notice")}
        <a href=${MAC_SUFFIX_DOCS_URL} target="_blank" rel="noopener noreferrer"
          >${this._localize("device.mac_suffix_learn_more")}</a
        >`,
      dismissLabel: this._localize("device.mac_suffix_dismiss"),
      onDismiss: () => {
        this._dismissed = true;
      },
    };
    return editable
      ? renderNoticeBanner({
          ...base,
          ctaLabel: this._localize("device.mac_suffix_disable"),
          onCta: () => fireEvent(this, "request-disable-mac-suffix"),
        })
      : renderNoticeBanner(base);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-mac-suffix-notice": ESPHomeMacSuffixNotice;
  }
}
