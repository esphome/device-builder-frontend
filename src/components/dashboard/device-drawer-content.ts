import { consume } from "@lit/context";
import {
  mdiAccessPointNetwork,
  mdiAlertCircleOutline,
  mdiAutoFix,
  mdiBluetooth,
  mdiBroom,
  mdiCheckCircleOutline,
  mdiChevronDown,
  mdiChevronUp,
  mdiEthernet,
  mdiFileDocumentOutline,
  mdiFingerprint,
  mdiHarddisk,
  mdiInformationOutline,
  mdiIpNetworkOutline,
  mdiLan,
  mdiLock,
  mdiLockAlert,
  mdiLockClock,
  mdiLockOpenVariant,
  mdiMapMarkerOutline,
  mdiMemory,
  mdiMessage,
  mdiNetworkOutline,
  mdiOpenInNew,
  mdiSync,
  mdiTagMultiple,
  mdiTextShort,
  mdiUpdate,
  mdiUpload,
} from "@mdi/js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/esphome-api.js";
import type { IntegrationDoc } from "../../api/types/components.js";
import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { ReachabilityStateEvent } from "../../api/types/reachability.js";
import type { LocalizeFunc } from "../../common/localize.js";
import {
  apiContext,
  integrationDocsContext,
  localizeContext,
} from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { showPendingChanges, showUpdateAvailable } from "../../util/device-sync.js";
import { getEncryptionState } from "../../util/encryption-state.js";
import { ReachabilityFollower } from "../../util/reachability-follower.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { renderReachabilitySection } from "./device-drawer-content/reachability.js";
import {
  renderBluetoothMacRow,
  renderBuildSizeRow,
  renderConfigHashSection,
  renderEncryptionBadge,
  renderEthernetMacRow,
  renderHostnameRow,
  renderIpAddressRow,
  renderLabelsSection,
  renderLoadedIntegrationsSection,
  renderMacAddressRow,
  renderRow,
  renderVersionSection,
} from "./device-drawer-content/render-sections.js";
import { deviceDrawerContentStyles } from "./device-drawer-content/styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../labels/device-labels-editor.js";

registerMdiIcons({
  "access-point-network": mdiAccessPointNetwork,
  "alert-circle-outline": mdiAlertCircleOutline,
  "auto-fix": mdiAutoFix,
  bluetooth: mdiBluetooth,
  broom: mdiBroom,
  "check-circle-outline": mdiCheckCircleOutline,
  "chevron-down": mdiChevronDown,
  "chevron-up": mdiChevronUp,
  ethernet: mdiEthernet,
  "file-document-outline": mdiFileDocumentOutline,
  fingerprint: mdiFingerprint,
  harddisk: mdiHarddisk,
  "information-outline": mdiInformationOutline,
  "ip-network-outline": mdiIpNetworkOutline,
  lan: mdiLan,
  lock: mdiLock,
  "lock-alert": mdiLockAlert,
  "lock-clock": mdiLockClock,
  "lock-open-variant": mdiLockOpenVariant,
  "map-marker-outline": mdiMapMarkerOutline,
  memory: mdiMemory,
  message: mdiMessage,
  "network-outline": mdiNetworkOutline,
  "open-in-new": mdiOpenInNew,
  sync: mdiSync,
  "tag-multiple": mdiTagMultiple,
  "text-short": mdiTextShort,
  update: mdiUpdate,
  upload: mdiUpload,
});

@customElement("esphome-device-drawer-content")
export class ESPHomeDeviceDrawerContent extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  _localize: LocalizeFunc = (key) => key;
  @consume({ context: integrationDocsContext, subscribe: true })
  @state()
  _integrationDocs: Record<string, IntegrationDoc> = {};
  @consume({ context: apiContext }) @state() _api?: ESPHomeAPI;

  @property({ attribute: false }) device!: ConfiguredDevice;

  // Falls back to true for tests that render the content directly.
  @property({ type: Boolean, attribute: "drawer-open" }) drawerOpen = true;

  // Gates destructive in-content actions (build-size broom) so the user can't
  // supersede a running build. Forwarded from <esphome-device-drawer>.
  @property({ type: Boolean, reflect: true }) busy = false;

  @state() _reachability: ReachabilityStateEvent | null = null;

  // Wall-clock anchor for the snapshot — rendered age =
  // snapshot.value + (now - anchor) / 1000, advanced by the 1Hz tick.
  @state() _reachabilityAnchorMs = 0;

  // Collapsed by default — flips when the user clicks the chevron on a
  // multi-IP device (typical when IPv6 is in play).
  @state() _ipExpanded = false;

  // Registered via addController; drives itself from host updates.
  private readonly _follower = new ReachabilityFollower(this, {
    api: () => this._api,
    deviceName: () => (this.drawerOpen && this.device ? this.device.name : null),
    onEvent: (state) => {
      this._reachability = state;
      this._reachabilityAnchorMs = Date.now();
    },
    onTeardown: () => {
      this._reachability = null;
      this._reachabilityAnchorMs = 0;
    },
    // Rendered values (ages, the mDNS-expiry countdown) resolve at
    // second precision.
    tickRender: true,
  });

  static styles = [espHomeStyles, deviceDrawerContentStyles];

  protected render() {
    const d = this.device;
    if (!d) return nothing;

    const showModified = showPendingChanges(d);
    const showUpdate = showUpdateAvailable(d);
    // Four-state encryption indicator. "none" = no Native API surface — no badge.
    const encState = getEncryptionState({
      api_enabled: d.api_enabled,
      api_encrypted: d.api_encrypted,
      api_encryption_active: d.runtime_state.api_encryption_active,
      has_pending_changes: d.has_pending_changes,
    });
    const apiEnabled = encState !== "none";
    const migrationAvailable = d.migration_available === true;
    const showAnyBadge = showModified || showUpdate || migrationAvailable || apiEnabled;

    return html`
      ${
        showAnyBadge
          ? html`<div class="status-badges">
              ${
                showModified
                  ? html`<span class="status-badge status-badge--modified">
                      <wa-icon library="mdi" name="alert-circle-outline"></wa-icon>
                      ${this._localize("dashboard.status_modified")}
                    </span>`
                  : nothing
              }
              ${
                showUpdate
                  ? html`<span class="status-badge status-badge--update">
                      <wa-icon library="mdi" name="update"></wa-icon>
                      ${this._localize("dashboard.status_update_available")}
                    </span>`
                  : nothing
              }
              ${
                migrationAvailable
                  ? html`<span class="status-badge status-badge--migration">
                      <wa-icon library="mdi" name="auto-fix"></wa-icon>
                      ${this._localize("dashboard.status_migration_available")}
                    </span>`
                  : nothing
              }
              ${apiEnabled ? renderEncryptionBadge(this, d, encState) : nothing}
            </div>`
          : nothing
      }
      <div class="section">
        <h4 class="section-title">${this._localize("dashboard.drawer_device_info")}</h4>
        ${renderRow(
          "information-outline",
          this._localize("dashboard.drawer_name"),
          d.friendly_name || d.name
        )}
        ${renderHostnameRow(this, d)} ${renderIpAddressRow(this, d)}
        ${renderMacAddressRow(d, this._localize)}
        ${renderEthernetMacRow(d, this._localize)}
        ${renderBluetoothMacRow(d, this._localize)}
        ${renderRow(
          "memory",
          this._localize("dashboard.drawer_platform"),
          d.target_platform
        )}
        ${renderBuildSizeRow(this, d)}
        ${
          d.area
            ? renderRow(
                "map-marker-outline",
                this._localize("dashboard.drawer_area"),
                d.area
              )
            : nothing
        }
      </div>

      ${renderLabelsSection(d, this._localize)} ${renderReachabilitySection(this)}
      ${renderVersionSection(d, this._localize)}

      <div class="section">
        <h4 class="section-title">${this._localize("dashboard.drawer_configuration")}</h4>
        ${renderRow(
          "file-document-outline",
          this._localize("dashboard.drawer_config_file"),
          d.configuration,
          true
        )}
        ${renderRow("text-short", this._localize("dashboard.drawer_comment"), d.comment)}
      </div>

      ${renderConfigHashSection(d, this._localize)}
      ${renderLoadedIntegrationsSection(d, this._localize, this._integrationDocs)}
    `;
  }

  // willUpdate, not updated: controllers' hostUpdated (the follower's
  // reconcile) runs before the host's updated, so a memo cleared there
  // would miss this cycle and wait out a 1 Hz tick.
  protected willUpdate(changed: Map<string, unknown>) {
    // The dashboard re-binds device on every DEVICE_UPDATED push (state flap,
    // IP/version change). Only reset state when the drawer is reused for a
    // *different* device — compare configuration so same-device updates
    // don't reset _ipExpanded. The follower reconciles itself per update.
    const previousDevice = changed.get("device") as ConfiguredDevice | null | undefined;
    const deviceTargetMoved =
      changed.has("device") &&
      (previousDevice?.configuration ?? null) !== (this.device?.configuration ?? null);
    if (deviceTargetMoved) {
      this._ipExpanded = false;
    }
    if (deviceTargetMoved || changed.has("drawerOpen")) {
      // A device switch or drawer reopen is an explicit fresh chance;
      // don't carry a failed-subscribe memo across it.
      this._follower.retry();
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-drawer-content": ESPHomeDeviceDrawerContent;
  }
}
