import { consume } from "@lit/context";
import {
  mdiAlertCircleOutline,
  mdiFileDocumentOutline,
  mdiInformationOutline,
  mdiIpNetworkOutline,
  mdiLock,
  mdiLockAlert,
  mdiLockClock,
  mdiLockOpenVariant,
  mdiMemory,
  mdiTagMultiple,
  mdiTextShort,
  mdiUpdate,
  mdiUpload,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import type { ConfiguredDevice } from "../../api/types.js";
import {
  integrationDocsContext,
  localizeContext,
} from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { getEncryptionState } from "../../util/encryption-state.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "alert-circle-outline": mdiAlertCircleOutline,
  "file-document-outline": mdiFileDocumentOutline,
  "information-outline": mdiInformationOutline,
  "ip-network-outline": mdiIpNetworkOutline,
  lock: mdiLock,
  "lock-alert": mdiLockAlert,
  "lock-clock": mdiLockClock,
  "lock-open-variant": mdiLockOpenVariant,
  memory: mdiMemory,
  "tag-multiple": mdiTagMultiple,
  "text-short": mdiTextShort,
  update: mdiUpdate,
  upload: mdiUpload,
});

/**
 * Whitelist docs URLs to the canonical esphome.io site over HTTPS.
 *
 * The map is populated by the backend from the in-house catalog, so a
 * compromised payload is the practical concern here — interpolating an
 * untrusted ``href`` directly would let a ``javascript:`` or
 * ``data:`` scheme run code on click. Bound the rendered anchors to
 * exactly the host the catalog targets and fall back to plain text
 * otherwise.
 */
function _isSafeDocsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "esphome.io";
  } catch {
    return false;
  }
}

@customElement("esphome-device-drawer-content")
export class ESPHomeDeviceDrawerContent extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: integrationDocsContext, subscribe: true })
  @state()
  private _integrationDocs: Record<string, string> = {};

  @property({ attribute: false })
  device!: ConfiguredDevice;

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
      }

      .section {
        margin-bottom: var(--wa-space-l);
      }

      .section-title {
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-quiet);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin: 0 0 var(--wa-space-s);
        padding-bottom: var(--wa-space-xs);
        border-bottom: var(--wa-border-width-s) solid
          var(--wa-color-surface-border);
      }

      .row {
        display: flex;
        align-items: flex-start;
        gap: var(--wa-space-s);
        padding: var(--wa-space-xs) 0;
      }

      .row + .row {
        border-top: var(--wa-border-width-s) solid
          color-mix(in srgb, var(--wa-color-surface-border), transparent 50%);
      }

      .icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: var(--wa-border-radius-m);
        background: color-mix(
          in srgb,
          var(--esphome-primary),
          transparent 90%
        );
        flex-shrink: 0;
        margin-top: 2px;
      }

      .icon wa-icon {
        font-size: 16px;
        color: var(--esphome-primary);
      }

      .content {
        flex: 1;
        min-width: 0;
      }

      .label {
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
        margin-bottom: 2px;
      }

      .value {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-normal);
        word-break: break-word;
      }

      .value.mono {
        font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
          monospace;
        font-size: var(--wa-font-size-xs);
      }

      .value.muted {
        color: var(--wa-color-text-quiet);
        font-style: italic;
      }

      .tags-wrap {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 4px;
      }

      .tag {
        display: inline-flex;
        padding: 3px 10px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-quiet);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      /* Linked tags get the dashboard's primary colour to read as
         "this opens something" without pulling so far from the plain
         tag styling that the row looks visually noisy. text-decoration
         is reset because the anchor variant inherits the .tag chrome
         and the underline would clash with the rounded pill shape. */
      .tag--link {
        color: var(--esphome-primary);
        text-decoration: none;
        cursor: pointer;
        transition:
          background 0.12s,
          border-color 0.12s;
      }

      .tag--link:hover,
      .tag--link:focus-visible {
        background: color-mix(in srgb, var(--esphome-primary), transparent 90%);
        border-color: color-mix(in srgb, var(--esphome-primary), transparent 60%);
      }

      /* Keyboard users tabbing onto the tag need the same affordance
         mouse users get on hover, plus a visible focus ring so the
         active tag stands out from its peers in the row. */
      .tag--link:focus-visible {
        outline: 2px solid var(--esphome-primary);
        outline-offset: 2px;
      }

      .status-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: var(--wa-space-l);
      }

      .status-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        letter-spacing: 0.02em;
      }

      .status-badge wa-icon {
        font-size: 13px;
      }

      .status-badge--modified {
        background: color-mix(in srgb, var(--esphome-warning, #f59e0b), transparent 85%);
        color: var(--esphome-warning, #d97706);
      }

      .status-badge--update {
        background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
        color: var(--esphome-primary);
      }

      .status-badge--encrypted {
        background: color-mix(in srgb, var(--esphome-success), transparent 88%);
        color: var(--esphome-success);
      }

      .status-badge--unencrypted {
        background: color-mix(in srgb, var(--esphome-warning, #f59e0b), transparent 85%);
        color: var(--esphome-warning, #d97706);
      }

      .status-badge--encryption-pending {
        background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
        color: var(--esphome-primary);
      }

      .status-badge--encryption-mismatch {
        background: color-mix(in srgb, var(--esphome-error), transparent 88%);
        color: var(--esphome-error);
      }
    `,
  ];

  protected render() {
    const d = this.device;
    if (!d) return nothing;

    const hasPendingChanges = d.has_pending_changes === true;
    const hasUpdateAvailable = d.update_available;
    // Four-state encryption indicator. ``getEncryptionState`` returns
    // ``"none"`` for devices without a Native API surface — those
    // shouldn't carry an "insecure" warning. The other four states
    // (active / pending / mismatch / plaintext) each map to a distinct
    // badge variant.
    const encState = getEncryptionState(d);
    const apiEnabled = encState !== "none";
    const showAnyBadge = hasPendingChanges || hasUpdateAvailable || apiEnabled;

    return html`
      ${showAnyBadge
        ? html`<div class="status-badges">
            ${hasPendingChanges
              ? html`<span class="status-badge status-badge--modified">
                  <wa-icon library="mdi" name="alert-circle-outline"></wa-icon>
                  ${this._localize("dashboard.status_modified")}
                </span>`
              : nothing}
            ${hasUpdateAvailable
              ? html`<span class="status-badge status-badge--update">
                  <wa-icon library="mdi" name="update"></wa-icon>
                  ${this._localize("dashboard.status_update_available")}
                </span>`
              : nothing}
            ${apiEnabled ? this._renderEncryptionBadge(encState) : nothing}
          </div>`
        : nothing}
      <div class="section">
        <h4 class="section-title">${this._localize("dashboard.drawer_device_info")}</h4>
        ${this._row("information-outline", this._localize("dashboard.drawer_name"), d.friendly_name || d.name)}
        ${this._row("ip-network-outline", this._localize("dashboard.drawer_ip_address"), d.ip || d.address, true)}
        ${this._row("memory", this._localize("dashboard.drawer_platform"), d.target_platform)}
      </div>

      <div class="section">
        <h4 class="section-title">${this._localize("dashboard.drawer_version")}</h4>
        ${this._row("tag-multiple", this._localize("dashboard.drawer_current_version"), d.current_version, true)}
        ${this._row("upload", this._localize("dashboard.drawer_deployed_version"), d.deployed_version, true)}
      </div>

      <div class="section">
        <h4 class="section-title">${this._localize("dashboard.drawer_configuration")}</h4>
        ${this._row("file-document-outline", this._localize("dashboard.drawer_config_file"), d.configuration, true)}
        ${this._row("text-short", this._localize("dashboard.drawer_comment"), d.comment)}
      </div>

      ${d.loaded_integrations && d.loaded_integrations.length > 0
        ? html`
            <div class="section">
              <h4 class="section-title">${this._localize("dashboard.drawer_loaded_integrations")}</h4>
              <div class="tags-wrap">
                ${d.loaded_integrations.map((i) => {
                  const url = this._integrationDocs[i];
                  return url && _isSafeDocsUrl(url)
                    ? html`<a
                        class="tag tag--link"
                        href=${url}
                        target="_blank"
                        rel="noopener noreferrer"
                        >${i}</a
                      >`
                    : html`<span class="tag">${i}</span>`;
                })}
              </div>
            </div>
          `
        : nothing}
    `;
  }

  private _renderEncryptionBadge(state: "active" | "plaintext" | "pending" | "mismatch" | "none") {
    /* The four-state mapping for the drawer's coloured pill. The
       ``getEncryptionVisual`` helper carries the icon + tooltip
       choices for the icon-only views (card, table); the drawer adds
       a localized label too, so it owns the per-state class/label
       table here. */
    const variants = {
      active: {
        cls: "status-badge--encrypted",
        icon: "lock",
        labelKey: "dashboard.table_status_encrypted",
        titleKey: "dashboard.table_status_encrypted_tooltip",
      },
      plaintext: {
        cls: "status-badge--unencrypted",
        icon: "lock-open-variant",
        labelKey: "dashboard.table_status_unencrypted",
        titleKey: "dashboard.table_status_unencrypted_tooltip",
      },
      pending: {
        cls: "status-badge--encryption-pending",
        icon: "lock-clock",
        labelKey: "dashboard.table_status_encryption_pending",
        titleKey: "dashboard.table_status_encryption_pending_tooltip",
      },
      mismatch: {
        cls: "status-badge--encryption-mismatch",
        icon: "lock-alert",
        labelKey: "dashboard.table_status_encryption_mismatch",
        titleKey: "dashboard.table_status_encryption_mismatch_tooltip",
      },
    } as const;
    if (state === "none") return nothing;
    const v = variants[state];
    return html`<span class="status-badge ${v.cls}" title=${this._localize(v.titleKey)}>
      <wa-icon library="mdi" name=${v.icon}></wa-icon>
      ${this._localize(v.labelKey)}
    </span>`;
  }

  private _row(icon: string, label: string, value: string | null, mono = false) {
    const empty = !value;
    return html`
      <div class="row">
        <div class="icon">
          <wa-icon library="mdi" name=${icon}></wa-icon>
        </div>
        <div class="content">
          <div class="label">${label}</div>
          <div class="value ${mono ? "mono" : ""} ${empty ? "muted" : ""}">
            ${value || "\u2014"}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-drawer-content": ESPHomeDeviceDrawerContent;
  }
}
