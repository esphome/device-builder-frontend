/**
 * Warning nudge shown when the config keeps `name_add_mac_suffix: true`:
 * the device then announces itself as `<name>-<suffix>`, which never
 * matches this config, so its online status can't be tracked. The
 * option is a provisioning feature; the CTA rewrites the flag to
 * `false` in the draft (the device keeps its suffixed hostname until
 * the next install). Detection is a pure line scan of the buffer — no
 * backend round-trip.
 */
import { consume } from "@lit/context";
import { mdiAlertOutline, mdiClose } from "@mdi/js";
import { css, html, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { fireEvent } from "../../util/fire-event.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { indentOf } from "../../util/yaml-line-walker.js";
import { TOP_LEVEL_KEY_START_RE } from "../../util/yaml-section-lexer.js";
import { findSectionStart } from "../../util/yaml-section-reader.js";
import { renderNoticeBanner } from "./notice-banner.js";
import { noticeBannerStyles, noticeCloseStyles } from "./notice-banner.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ "alert-outline": mdiAlertOutline, close: mdiClose });

const DOCS_URL =
  "https://github.com/esphome/device-builder#device-status-and-name_add_mac_suffix";

/** esphome `cv.boolean` truthy vocabulary (quotes stripped before the test). */
const TRUTHY_RE = /^(true|yes|on|enable)$/i;

const KEY_VALUE_RE = /^(name_add_mac_suffix\s*:\s*)([^#\s]+)/;

/** Zero-based line index of a truthy direct-child `name_add_mac_suffix:`
 *  under `esphome:`, or -1. Line scan, not parsed values, so it works on
 *  mid-edit drafts. */
export function findTruthyMacSuffixLine(yaml: string): number {
  const lines = yaml.split("\n");
  const start = findSectionStart(lines, "esphome");
  if (start < 0) return -1;
  let childIndent: number | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "" || l.trimStart().startsWith("#")) continue;
    if (TOP_LEVEL_KEY_START_RE.test(l)) break; // next top-level section
    const indent = indentOf(l);
    if (childIndent === null) childIndent = indent;
    if (indent < childIndent) break;
    if (indent !== childIndent) continue; // deeper-nested key, not a direct child
    const match = KEY_VALUE_RE.exec(l.trimStart());
    if (match) {
      const value = match[2].replace(/^["']|["']$/g, "");
      return TRUTHY_RE.test(value) ? i : -1;
    }
  }
  return -1;
}

/** Rewrite the truthy flag to `false`, preserving the rest of the line;
 *  `null` when the flag isn't set. */
export function disableMacSuffixInYaml(yaml: string): string | null {
  const line = findTruthyMacSuffixLine(yaml);
  if (line < 0) return null;
  const lines = yaml.split("\n");
  // The finder matched against the trimmed line, so drop the anchor here.
  lines[line] = lines[line].replace(/(name_add_mac_suffix\s*:\s*)([^#\s]+)/, "$1false");
  return lines.join("\n");
}

@customElement("esphome-mac-suffix-notice")
export class ESPHomeMacSuffixNotice extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property() configuration = "";

  /** The page's draft buffer. */
  @property({ attribute: false }) yaml = "";

  @state() private _detected = false;

  @state() private _dismissed = false;

  protected willUpdate(changed: PropertyValues) {
    if (changed.has("configuration")) this._dismissed = false;
    if (changed.has("yaml") || changed.has("configuration")) {
      this._detected = findTruthyMacSuffixLine(this.yaml) >= 0;
    }
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
    if (!this._detected || this._dismissed) return nothing;
    return renderNoticeBanner({
      icon: "alert-outline",
      text: html`${this._localize("device.mac_suffix_notice")}
        <a href=${DOCS_URL} target="_blank" rel="noopener noreferrer"
          >${this._localize("device.mac_suffix_learn_more")}</a
        >`,
      ctaLabel: this._localize("device.mac_suffix_disable"),
      onCta: () => fireEvent(this, "request-disable-mac-suffix"),
      dismissLabel: this._localize("device.mac_suffix_dismiss"),
      onDismiss: () => {
        this._dismissed = true;
      },
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-mac-suffix-notice": ESPHomeMacSuffixNotice;
  }
}
