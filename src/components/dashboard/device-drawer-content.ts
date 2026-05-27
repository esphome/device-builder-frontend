import { consume } from "@lit/context";
import {
  mdiAccessPointNetwork,
  mdiAlertCircleOutline,
  mdiBluetooth,
  mdiBroom,
  mdiCheckCircleOutline,
  mdiChevronDown,
  mdiChevronUp,
  mdiFileDocumentOutline,
  mdiFingerprint,
  mdiHarddisk,
  mdiEthernet,
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
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import type {
  ConfiguredDevice,
  ReachabilityStateEvent,
  ReachabilitySubscription,
} from "../../api/types.js";
import type { ESPHomeAPI } from "../../api/esphome-api.js";
import {
  apiContext,
  integrationDocsContext,
  localizeContext,
} from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { getEncryptionState } from "../../util/encryption-state.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { deviceDrawerContentStyles } from "./device-drawer-content/styles.js";
import {
  renderBluetoothMacRow,
  renderBuildSizeRow,
  renderConfigHashSection,
  renderEncryptionBadge,
  renderEthernetMacRow,
  renderIpAddressRow,
  renderLabelsSection,
  renderLoadedIntegrationsSection,
  renderMacAddressRow,
  renderRow,
  renderVersionSection,
} from "./device-drawer-content/render-sections.js";
import {
  reconcileSubscription,
  renderReachabilitySection,
  syncTickInterval,
  teardownSubscription,
} from "./device-drawer-content/reachability.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../labels/device-labels-editor.js";

registerMdiIcons({
  "access-point-network": mdiAccessPointNetwork,
  "alert-circle-outline": mdiAlertCircleOutline,
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
  _integrationDocs: Record<string, string> = {};
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

  // Tick counter the relative-time renderer reads from to force a 1Hz re-render.
  @state() _tick = 0;

  // Collapsed by default — flips when the user clicks the chevron on a
  // multi-IP device (typical when IPv6 is in play).
  @state() _ipExpanded = false;

  // Tracked separately from device.configuration so a swap to a new device
  // cleanly tears down the previous subscription before opening a new one.
  _subscribedDevice: string | null = null;
  _subscription: ReachabilitySubscription | null = null;

  // WS connection generation captured when the subscription opened. Compared
  // against api.connectionGeneration each reconcile — mismatch means the WS
  // dropped and we need to resubscribe even though the device name didn't change.
  _subscribedGeneration = 0;

  // "<deviceName>:<generation>" of the last logged failure / failed attempt.
  // Without these gates the 1Hz tick would log + retry forever during a
  // WS-down window. Both reset on natural progression (different device,
  // fresh WS) so transient failures self-heal.
  _loggedFailureKey: string | null = null;
  _failedSubscribeKey: string | null = null;
  _tickInterval: ReturnType<typeof setInterval> | null = null;

  static styles = [espHomeStyles, deviceDrawerContentStyles];

  protected render() {
    const d = this.device;
    if (!d) return nothing;

    const hasPendingChanges = d.has_pending_changes === true;
    const hasUpdateAvailable = d.update_available;
    // Four-state encryption indicator. "none" = no Native API surface — no badge.
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
            ${apiEnabled ? renderEncryptionBadge(this._localize, encState) : nothing}
          </div>`
        : nothing}
      <div class="section">
        <h4 class="section-title">${this._localize("dashboard.drawer_device_info")}</h4>
        ${renderRow(
          "information-outline",
          this._localize("dashboard.drawer_name"),
          d.friendly_name || d.name
        )}
        ${renderRow(
          "network-outline",
          this._localize("dashboard.drawer_address"),
          d.address,
          true
        )}
        ${renderIpAddressRow(this, d)} ${renderMacAddressRow(d, this._localize)}
        ${renderEthernetMacRow(d, this._localize)}
        ${renderBluetoothMacRow(d, this._localize)}
        ${renderRow(
          "memory",
          this._localize("dashboard.drawer_platform"),
          d.target_platform
        )}
        ${renderBuildSizeRow(this, d)}
        ${d.area
          ? renderRow(
              "map-marker-outline",
              this._localize("dashboard.drawer_area"),
              d.area
            )
          : nothing}
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

  protected updated(changed: Map<string, unknown>) {
    super.updated?.(changed);
    // The dashboard re-binds device on every DEVICE_UPDATED push (state flap,
    // IP/version change). Only churn subscriptions / reset state when the
    // drawer is reused for a *different* device — compare configuration so
    // same-device updates don't reset _ipExpanded or rotate the subscription.
    const previousDevice = changed.get("device") as ConfiguredDevice | null | undefined;
    const deviceTargetMoved =
      changed.has("device") &&
      (previousDevice?.configuration ?? null) !== (this.device?.configuration ?? null);
    if (deviceTargetMoved) {
      this._ipExpanded = false;
    }
    if (deviceTargetMoved || changed.has("drawerOpen") || changed.has("_api")) {
      reconcileSubscription(this);
      // Run the tick whenever there's a target, independent of whether the
      // subscribe succeeded — a failed initial subscribe gets retried at 1Hz.
      syncTickInterval(this);
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    teardownSubscription(this);
    if (this._tickInterval !== null) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-drawer-content": ESPHomeDeviceDrawerContent;
  }
}
