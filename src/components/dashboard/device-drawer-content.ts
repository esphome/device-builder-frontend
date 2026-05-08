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
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { activeLocale, type LocalizeFunc } from "../../common/localize.js";
import type {
  ConfiguredDevice,
  ReachabilitySource,
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
import { formatFileSize } from "../../util/format-file-size.js";
import { splitIntegrations } from "../../util/integration-split.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { buildWebUiUrl } from "../../util/web-ui-url.js";
import { renderIpValue } from "./device-drawer-render.js";
import {
  ageOf,
  formatSecondsAgo,
  getNumberFormatter,
} from "../../util/relative-time.js";

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

/** Per-signal config for one Reachability row. The render method
 *  iterates a static table of these so adding a new freshness
 *  channel (a future "ARP-cached" / "WS-heartbeat" line) is one
 *  array entry instead of yet another duplicated row block. */
interface ReachabilityRowSpec {
  source: "mdns" | "ping" | "mqtt";
  icon: string;
  labelKey: string;
  age: number | null;
  rttMs?: number | null;
}

@customElement("esphome-device-drawer-content")
export class ESPHomeDeviceDrawerContent extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: integrationDocsContext, subscribe: true })
  @state()
  private _integrationDocs: Record<string, string> = {};

  @consume({ context: apiContext })
  @state()
  private _api?: ESPHomeAPI;

  @property({ attribute: false })
  device!: ConfiguredDevice;

  /** Whether the drawer is currently visible. The reachability
   *  subscription is gated on this so a slid-off drawer doesn't
   *  keep streaming events. Falls back to ``true`` for tests that
   *  render the content directly without the parent drawer. */
  @property({ type: Boolean, attribute: "drawer-open" })
  drawerOpen = true;

  /** True while a firmware job is in flight for this device.
   *  Gates the destructive in-content actions (the Build Size
   *  row's broom button) so the user can't supersede a running
   *  build by accident — the backend rejects ``firmware/clean``
   *  in that state too, but disabling the affordance up front
   *  avoids the round-trip and the resulting toast. Forwarded
   *  from the parent ``<esphome-device-drawer>``. */
  @property({ type: Boolean, reflect: true })
  busy = false;

  /** Latest reachability snapshot pushed by the backend over the
   *  per-device WS subscription. ``null`` until the initial event
   *  arrives or after the subscription tears down. */
  @state()
  private _reachability: ReachabilityStateEvent | null = null;

  /** Wall-clock anchor for the last received snapshot. The
   *  ``*_last_seen_seconds_ago`` values are stamped at send time
   *  on the backend, so the rendered relative time is
   *  ``snapshot.value + (now - anchor) / 1000``. Lets the 1Hz
   *  re-render tick advance the displayed age without a fresh
   *  push from the server. */
  @state()
  private _reachabilityAnchorMs = 0;

  /** Tick counter the relative-time renderer reads from to force a
   *  re-render at 1Hz. Mutating it inside ``setInterval`` is
   *  what nudges Lit's reactivity — the actual value is unused. */
  @state()
  private _tick = 0;

  /** Whether the IP-address row is showing the full list. Collapsed
   *  by default to keep the drawer scannable for the common
   *  single-IPv4 case; flips when the user clicks the chevron on a
   *  multi-IP device (typical when IPv6 is in play). */
  @state()
  private _ipExpanded = false;

  /** Currently subscribed device name. Tracked separately from
   *  ``device.configuration`` so a swap to a new device cleanly
   *  tears down the previous subscription before opening a new
   *  one. */
  private _subscribedDevice: string | null = null;

  /** Active subscription handle. ``unsubscribe()`` is called on
   *  disconnect / device change / drawer close. */
  private _subscription: ReachabilitySubscription | null = null;

  /** Connection generation captured when the active subscription
   *  was opened. Compared against ``api.connectionGeneration`` on
   *  every reconcile tick — a mismatch means the WS dropped and
   *  reconnected (which clears the API's ``_eventSubscriptions``
   *  map) and we need to resubscribe even though the device name
   *  didn't change. */
  private _subscribedGeneration = 0;

  /** ``"<deviceName>:<generation>"`` of the last subscribe failure
   *  we logged, or ``null`` if we haven't logged yet for this
   *  (device, connection) pair. Without this gate, a transient
   *  WS-not-yet-connected window during drawer-open would log the
   *  same warning every tick (the 1Hz tick runs reconcile,
   *  reconcile re-attempts the subscribe, which logs on failure).
   *  Reset by the natural progression — a new device or a new
   *  WS open both flip the key, so the next failure logs once. */
  private _loggedFailureKey: string | null = null;

  /** ``"<deviceName>:<generation>"`` of the last subscribe attempt
   *  that failed. The reconcile tick checks this before
   *  re-attempting, so a permanent error (NOT_FOUND for an
   *  unknown device, INVALID_ARGS for a bad arg) doesn't fire
   *  ``devices/subscribe_reachability`` once a second forever
   *  while the drawer stays open. The key resets when the
   *  natural progression changes one of its components — a
   *  different device selection or a fresh WS connection —
   *  so a transient WS-down window self-heals on reconnect
   *  without the user having to close-and-reopen the drawer. */
  private _failedSubscribeKey: string | null = null;

  /** ``setInterval`` handle for the 1Hz relative-time re-render
   *  tick. Cleared together with the subscription. */
  private _tickInterval: ReturnType<typeof setInterval> | null = null;

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

      .ip-toggle {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 2px 0;
        margin-top: 2px;
        background: none;
        border: none;
        font-family: inherit;
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
        cursor: pointer;
      }
      .ip-toggle:hover {
        color: var(--wa-color-text-normal);
      }
      .ip-toggle wa-icon {
        font-size: 14px;
      }

      .ip-value {
        display: inline-flex;
        align-items: center;
        gap: var(--wa-space-xs);
        /* Cap to the row's text column so a long IPv6 literal wraps
           in-place instead of pushing the visit-link icon out of the
           drawer. The flex children below carry the actual wrapping
           (min-width: 0) and shrink-protection (flex-shrink: 0). */
        max-width: 100%;
      }
      /* Flex items default to min-width: auto, which prevents the IP
         text from shrinking below its intrinsic width — long IPv6
         literals would then overflow. Force min-width: 0 and let
         overflow-wrap break inside the address. */
      .ip-value-text {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      /* Match the table's .cell-action-btn icon-only target geometry
         so the drawer link is reachable by keyboard and touch —
         square hit area, :focus-visible ring, and the same hover
         affordance the table-cell visit-web button uses.
         flex-shrink: 0 keeps the icon a stable 24x24 even when the
         IPv6 text is wrapping next to it. */
      .ip-visit-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        width: 24px;
        height: 24px;
        border-radius: var(--wa-border-radius-m);
        color: var(--wa-color-text-quiet);
        text-decoration: none;
        transition:
          background 0.12s,
          color 0.12s;
      }
      .ip-visit-link:hover {
        background: var(--wa-color-surface-lowered);
        color: var(--esphome-primary);
      }
      .ip-visit-link:focus-visible {
        outline: 2px solid var(--esphome-primary);
        outline-offset: 2px;
        color: var(--esphome-primary);
      }
      .ip-visit-link wa-icon {
        font-size: 14px;
      }

      .build-size-value {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .build-size-clean {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        padding: 0;
        border: none;
        border-radius: var(--wa-border-radius-s);
        background: none;
        color: var(--wa-color-text-quiet);
        cursor: pointer;
      }
      .build-size-clean:hover {
        color: var(--wa-color-text-normal);
        background: color-mix(
          in srgb,
          var(--esphome-primary),
          transparent 88%
        );
      }
      /* Disabled state uses aria-disabled rather than the native
         disabled attribute so the button stays focusable and the
         title tooltip remains discoverable on hover — disabled
         native buttons hide both, which would silently drop the
         "wait for the current build…" explanation. The click
         handler is gated separately on the busy property. */
      .build-size-clean--disabled,
      .build-size-clean--disabled:hover {
        color: var(--wa-color-text-quiet);
        background: none;
        cursor: not-allowed;
        opacity: 0.5;
      }
      .build-size-clean wa-icon {
        font-size: 14px;
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

      /* Auto-loaded-integrations collapsible. The drawer's primary
         "Loaded Integrations" row shows the user-meaningful chips
         inline; auto-loaded dependencies (the upstream AUTO_LOAD
         chain — md5, mdns, web_server_base, etc.) tuck in here
         so a 30-component config doesn't drown the panel in
         framework noise. The summary row gets the muted text
         colour so it reads as secondary metadata, not as another
         tag-row header. */
      .auto-loaded-details {
        margin-top: var(--wa-space-s);
      }

      .auto-loaded-details > summary {
        cursor: pointer;
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
        padding: 2px 0;
        user-select: none;
      }

      .auto-loaded-details > summary:hover {
        color: var(--wa-color-text-normal);
      }

      .tags-wrap--auto-loaded {
        margin-top: var(--wa-space-2xs);
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

      /* Compact in/out-of-sync line shared by both the version and
         config-hash sections — anywhere the drawer needs a "local
         matches deployed" verdict. Reads like the encryption /
         pending / update badges above so the drawer's status surface
         stays visually consistent; the rows underneath then carry
         the actual values being compared. */
      .sync-status {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        margin-bottom: var(--wa-space-s);
      }

      .sync-status wa-icon {
        font-size: 13px;
      }

      .sync-status--match {
        background: color-mix(in srgb, var(--esphome-success), transparent 88%);
        color: var(--esphome-success);
      }

      .sync-status--diff {
        background: color-mix(in srgb, var(--esphome-warning, #f59e0b), transparent 85%);
        color: var(--esphome-warning, #d97706);
      }

      /* Small "active" pill that sits next to the row label of the
         reachability source currently driving the device's online
         state. Same chrome shape as the section badges above but
         compact enough to share a line with the label. */
      .reachability-badge {
        display: inline-flex;
        align-items: center;
        margin-left: 6px;
        padding: 1px 6px;
        border-radius: 999px;
        font-size: 0.7em;
        font-weight: var(--wa-font-weight-bold);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        background: color-mix(in srgb, var(--esphome-success), transparent 85%);
        color: var(--esphome-success);
      }

      /* Subtle separation for the round-trip-ms suffix on the Ping
         row so it reads as additional info rather than part of the
         relative-time string. */
      .reachability-rtt {
        color: var(--wa-color-text-quiet);
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
        ${this._row("network-outline", this._localize("dashboard.drawer_address"), d.address, true)}
        ${this._renderIpAddressRow(d)}
        ${this._renderMacAddressRow(d)}
        ${this._renderEthernetMacRow(d)}
        ${this._renderBluetoothMacRow(d)}
        ${this._row("memory", this._localize("dashboard.drawer_platform"), d.target_platform)}
        ${this._renderBuildSizeRow(d)}
        ${d.area ? this._row("map-marker-outline", this._localize("dashboard.drawer_area"), d.area) : nothing}
      </div>

      ${this._renderLabelsSection(d)}

      ${this._renderReachabilitySection()}

      ${this._renderVersionSection(d)}

      <div class="section">
        <h4 class="section-title">${this._localize("dashboard.drawer_configuration")}</h4>
        ${this._row("file-document-outline", this._localize("dashboard.drawer_config_file"), d.configuration, true)}
        ${this._row("text-short", this._localize("dashboard.drawer_comment"), d.comment)}
      </div>

      ${this._renderConfigHashSection(d)}

      ${this._renderLoadedIntegrationsSection(d)}
    `;
  }

  /**
   * Render the "Loaded Integrations" section with a direct /
   * auto-loaded split.
   *
   * `loaded_integrations` from the backend lumps every integration
   * upstream ESPHome resolved at compile time — the user's
   * top-level blocks, their `- platform: ...` references, AND the
   * AUTO_LOAD chain those things drag in (`md5` from WPA2 password
   * hashing, `mdns` from `api`, `web_server_base` from
   * `web_server`, `voltage_sampler` from ADC sensors). For
   * non-trivial configs the auto-loaded chain dominates, burying
   * the user-meaningful entries.
   *
   * Backend's `directly_referenced_integrations` is the subset
   * the user actually wrote (issue #422 fix); the complement is
   * the auto-loaded chain. We render direct chips inline, and
   * tuck auto-loaded ones inside a `<details>` collapsible the
   * user can expand on demand.
   *
   * Falls back to rendering the flat `loaded_integrations` list
   * when the backend couldn't compute the split — empty
   * `directly_referenced_integrations` is the graceful-degrade
   * signal (resolved-config parse failed mid-edit).
   */
  private _renderLoadedIntegrationsSection(d: ConfiguredDevice) {
    if (!d.loaded_integrations || d.loaded_integrations.length === 0) {
      return nothing;
    }
    const { direct, indirect } = splitIntegrations(
      d.loaded_integrations,
      d.directly_referenced_integrations,
    );
    return html`
      <div class="section">
        <h4 class="section-title">
          ${this._localize("dashboard.drawer_loaded_integrations")}
        </h4>
        <div class="tags-wrap">${direct.map((i) => this._renderIntegrationTag(i))}</div>
        ${indirect.length > 0
          ? html`
              <details class="auto-loaded-details">
                <summary>
                  ${this._localize("dashboard.drawer_auto_loaded_integrations", {
                    count: String(indirect.length),
                  })}
                </summary>
                <div class="tags-wrap tags-wrap--auto-loaded">
                  ${indirect.map((i) => this._renderIntegrationTag(i))}
                </div>
              </details>
            `
          : nothing}
      </div>
    `;
  }

  private _renderIntegrationTag(name: string) {
    const url = this._integrationDocs[name];
    return url && _isSafeDocsUrl(url)
      ? html`<a
          class="tag tag--link"
          href=${url}
          target="_blank"
          rel="noopener noreferrer"
          >${name}</a
        >`
      : html`<span class="tag">${name}</span>`;
  }

  /**
   * Render the user-defined labels section with inline editor.
   *
   * The editor consumes ``apiContext`` and ``labelsContext`` itself
   * — the drawer just hands it the device. Persists assignments
   * via ``devices/set_labels``; the resulting ``DEVICE_UPDATED``
   * push refreshes the ``device.labels`` array, which Lit reactivity
   * threads back into the editor's chip row.
   */
  private _renderLabelsSection(d: ConfiguredDevice) {
    return html`
      <div class="section">
        <h4 class="section-title">
          ${this._localize("dashboard.drawer_labels")}
        </h4>
        <esphome-device-labels-editor
          .device=${d}
        ></esphome-device-labels-editor>
      </div>
    `;
  }

  /**
   * Render the local-vs-deployed ESPHome version comparison.
   *
   * ``current_version`` is the dashboard's bundled ESPHome — the
   * version a fresh compile will produce — and
   * ``deployed_version`` is what the device's mDNS broadcast says
   * it's actually running. The pair tells "device is up-to-date with
   * the dashboard's toolchain" apart from "device runs an older
   * release that just hasn't been re-flashed since the dashboard was
   * upgraded". The frontend already drives an "Update available"
   * pill from this comparison; surfacing the underlying numbers in
   * the drawer is the diagnostic the pill is summarising. Skips the
   * whole section when neither side has populated yet (brand-new
   * device that has never compiled and never broadcast).
   */
  private _renderVersionSection(d: ConfiguredDevice) {
    const local = d.current_version || "";
    const deployed = d.deployed_version || "";
    if (!local && !deployed) return nothing;
    const matches = !!local && !!deployed && local === deployed;
    const statusIcon = matches ? "check-circle-outline" : "sync";
    const statusKey = matches
      ? "dashboard.drawer_version_in_sync"
      : "dashboard.drawer_version_out_of_sync";
    const statusCls = matches ? "sync-status sync-status--match" : "sync-status sync-status--diff";
    // Suppress the badge entirely when the device hasn't reported a
    // version yet (no mDNS announce). Comparing against an empty
    // string would always read "out of sync" — meaningless noise on
    // a freshly-added device that's never been online.
    const showStatus = !!local && !!deployed;
    return html`
      <div class="section">
        <h4 class="section-title">${this._localize("dashboard.drawer_version")}</h4>
        ${showStatus
          ? html`<div class=${statusCls}>
              <wa-icon library="mdi" name=${statusIcon}></wa-icon>
              <span>${this._localize(statusKey)}</span>
            </div>`
          : nothing}
        ${matches
          ? // In sync — collapse the two identical rows into one.
            // Showing "Current Version: 2026.5.0-dev" and
            // "Deployed Version: 2026.5.0-dev" stacked is redundant
            // and wastes drawer height.
            this._row(
              "tag-multiple",
              this._localize("dashboard.drawer_version"),
              local,
              true,
            )
          : html`
              ${this._row(
                "tag-multiple",
                this._localize("dashboard.drawer_current_version"),
                local,
                true,
              )}
              ${this._row(
                "upload",
                this._localize("dashboard.drawer_deployed_version"),
                deployed,
                true,
              )}
            `}
      </div>
    `;
  }

  /**
   * Render the local-vs-deployed config hash comparison.
   *
   * The two 8-char hashes are how the dashboard tells "device runs
   * the YAML you see in the editor" apart from "device runs an older
   * compile". Surfacing them in the drawer is the answer to "the
   * modified dot is on but the YAML hasn't changed — what's actually
   * mismatched?" — which until now had no diagnostic in the UI.
   * Suppress the section entirely on devices that have never been
   * compiled (no expected hash) and never broadcast their hash (no
   * deployed hash); there's nothing meaningful to show, and the
   * absence is itself communicated by the absence of the section.
   */
  private _renderConfigHashSection(d: ConfiguredDevice) {
    const expected = d.expected_config_hash || "";
    const deployed = d.deployed_config_hash || "";
    if (!expected && !deployed) return nothing;
    const matches = !!expected && !!deployed && expected === deployed;
    const statusIcon = matches ? "check-circle-outline" : "sync";
    const statusKey = matches
      ? "dashboard.drawer_config_hash_in_sync"
      : "dashboard.drawer_config_hash_out_of_sync";
    const statusCls = matches ? "sync-status sync-status--match" : "sync-status sync-status--diff";
    // Match the version section's gating: only show the pill when
    // both sides are populated. A device that has compiled but
    // hasn't broadcast yet (or vice versa) doesn't have enough data
    // for a verdict — the rows below already convey the missing
    // side via em-dashes, and an "Out of sync" pill against an empty
    // string would mis-state the situation.
    const showStatus = !!expected && !!deployed;
    return html`
      <div class="section">
        <h4 class="section-title">
          ${this._localize("dashboard.drawer_config_hash_title")}
        </h4>
        ${showStatus
          ? html`<div class=${statusCls}>
              <wa-icon library="mdi" name=${statusIcon}></wa-icon>
              <span>${this._localize(statusKey)}</span>
            </div>`
          : nothing}
        ${matches
          ? // In sync — show the hash once instead of twice. The
            // two-row form is reserved for the diagnostic "Local
            // vs Deployed" comparison; once they match the
            // distinction is meaningless and just doubles the
            // drawer height.
            this._row(
              "fingerprint",
              this._localize("dashboard.drawer_config_hash_value"),
              expected,
              true,
            )
          : html`
              ${this._row(
                "fingerprint",
                this._localize("dashboard.drawer_config_hash_local"),
                expected,
                true,
              )}
              ${this._row(
                "fingerprint",
                this._localize("dashboard.drawer_config_hash_deployed"),
                deployed,
                true,
              )}
            `}
      </div>
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

  /**
   * Render the resolved IP addresses for the device.
   *
   * Single IP renders as a plain row. Multi-IP devices (the IPv6 +
   * IPv4 case) collapse to the primary by default and surface a
   * chevron toggle so the extras stay one click away — keeps the
   * drawer scannable when the common case is "one address" but
   * still lets the user see the full set when they want it. An
   * en-dash placeholder renders when the device has never been
   * online so the row stays diagnostic.
   */
  private _renderIpAddressRow(d: ConfiguredDevice) {
    const list = d.ip_addresses;
    const label = this._localize("dashboard.drawer_ip_address");
    // Resolve once per render — ``buildWebUiUrl`` parses a URL and
    // both the empty-IP guard and ``_renderIpValue`` need the same
    // answer.
    const webUrl = buildWebUiUrl(d);
    if (list.length === 0) {
      // ``device.address`` (the YAML-declared mDNS hostname) plus a
      // configured ``web_port`` is enough to build a usable visit-web
      // URL even before the first resolved A/AAAA record arrives, so
      // route through ``_renderIpValue`` to surface the link in that
      // window. Falls back to ``_row``'s muted em-dash when neither
      // is available.
      if (!webUrl) {
        return this._row("ip-network-outline", label, "", true);
      }
      return html`
        <div class="row">
          <div class="icon">
            <wa-icon library="mdi" name="ip-network-outline"></wa-icon>
          </div>
          <div class="content">
            <div class="label">${label}</div>
            ${this._renderIpValue("", webUrl)}
          </div>
        </div>
      `;
    }
    if (list.length === 1) {
      return html`
        <div class="row">
          <div class="icon">
            <wa-icon library="mdi" name="ip-network-outline"></wa-icon>
          </div>
          <div class="content">
            <div class="label">${label}</div>
            ${this._renderIpValue(list[0], webUrl)}
          </div>
        </div>
      `;
    }
    const expanded = this._ipExpanded;
    const extra = list.length - 1;
    return html`
      <div class="row">
        <div class="icon">
          <wa-icon library="mdi" name="ip-network-outline"></wa-icon>
        </div>
        <div class="content">
          <div class="label">${label}</div>
          ${this._renderIpValue(list[0], webUrl)}
          ${expanded
            ? list
                .slice(1)
                .map((ip) => html`<div class="value mono">${ip}</div>`)
            : nothing}
          <button
            class="ip-toggle"
            type="button"
            aria-expanded=${expanded}
            @click=${() => {
              this._ipExpanded = !this._ipExpanded;
            }}
          >
            <wa-icon
              library="mdi"
              name=${expanded ? "chevron-up" : "chevron-down"}
            ></wa-icon>
            ${expanded
              ? this._localize("dashboard.drawer_ip_hide_extra")
              : this._localize("dashboard.drawer_ip_show_more", { n: extra })}
          </button>
        </div>
      </div>
    `;
  }

  private _renderIpValue(ip: string, url: string) {
    return renderIpValue(ip, url, this._localize);
  }

  /**
   * Render the device's primary MAC address (always; placeholder when unknown).
   *
   * Backend normalizes at ingest to canonical
   * ``XX:XX:XX:XX:XX:XX`` form, so ``d.mac_address`` is rendered
   * directly with no per-display formatting. The row stays visible
   * even before the first mDNS observation so users get a stable
   * diagnostic shape — same em-dash placeholder ``_row`` already
   * uses for the IP address row. The sidecar persists the value, so
   * a freshly-restarted dashboard typically lands with the MAC
   * pre-filled from the previous session.
   */
  private _renderMacAddressRow(d: ConfiguredDevice) {
    return this._row(
      "ethernet",
      this._localize("dashboard.drawer_mac_address"),
      d.mac_address,
      true,
    );
  }

  /**
   * Render the derived ethernet MAC, when distinct from the primary.
   *
   * Hidden when the YAML doesn't load the ``ethernet`` integration
   * or when the device's platform is single-MAC (RP2040 / RP2350)
   * and the derived value would just duplicate ``mac_address``.
   * Backend computes the offset (base + 3 on ESP32) so the frontend
   * just renders the canonical form.
   */
  private _renderEthernetMacRow(d: ConfiguredDevice) {
    if (!d.ethernet_mac || d.ethernet_mac === d.mac_address) return nothing;
    return this._row(
      "ethernet",
      this._localize("dashboard.drawer_ethernet_mac"),
      d.ethernet_mac,
      true,
    );
  }

  /**
   * Render the derived Bluetooth MAC, when present.
   *
   * Empty for non-ESP32 platforms (the offset table is ESP32-
   * specific) and for ESP32 devices whose YAML doesn't load any
   * ``esp32_ble*`` / ``bluetooth_*`` integration.
   */
  private _renderBluetoothMacRow(d: ConfiguredDevice) {
    if (!d.bluetooth_mac || d.bluetooth_mac === d.mac_address) return nothing;
    return this._row(
      "bluetooth",
      this._localize("dashboard.drawer_bluetooth_mac"),
      d.bluetooth_mac,
      true,
    );
  }

  /**
   * Render the cached build-directory size, with an inline "Clean" button.
   *
   * Hidden on devices that have never been compiled (the
   * backend's mtime-gated cache reports ``0`` for those). The
   * value updates lazily — backend re-walks only when the build
   * directory's mtime moves, which only happens on a fresh
   * compile or a clean, so the drawer's number can lag a
   * session's worth behind a CLI-driven build until the
   * dashboard's job-completion hook (or the next backend
   * restart) triggers a refresh.
   *
   * The "Clean" button bubbles a ``clean-build`` ``CustomEvent``
   * (with the device as ``detail``) up through the drawer to
   * ``dashboard.ts``, which routes it through the same
   * ``_openCommand(device, "clean")`` path as the table row
   * menu's clean action — same backend ``esphome clean`` job,
   * same job-completion hook that fires the build-size refresh.
   */
  private _renderBuildSizeRow(d: ConfiguredDevice) {
    if (!d.build_size_bytes) return nothing;
    return html`
      <div class="row">
        <div class="icon">
          <wa-icon library="mdi" name="harddisk"></wa-icon>
        </div>
        <div class="content">
          <div class="label">
            ${this._localize("dashboard.drawer_build_size")}
          </div>
          <div class="value build-size-value">
            <span>${formatFileSize(d.build_size_bytes)}</span>
            <button
              class="build-size-clean ${this.busy
                ? "build-size-clean--disabled"
                : ""}"
              type="button"
              aria-disabled=${this.busy ? "true" : "false"}
              title=${this.busy
                ? this._localize("dashboard.action_clean_build_busy")
                : this._localize("dashboard.action_clean_build")}
              aria-label=${this.busy
                ? this._localize("dashboard.action_clean_build_busy")
                : this._localize("dashboard.action_clean_build")}
              @click=${() => (this.busy ? null : this._emitCleanBuild(d))}
            >
              <wa-icon library="mdi" name="broom"></wa-icon>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private _emitCleanBuild(device: ConfiguredDevice) {
    this.dispatchEvent(
      new CustomEvent("clean-build", {
        detail: device,
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Render the per-signal Reachability section.
   *
   * Shows one row per channel the device has been observed on
   * (mDNS / Ping / MQTT). Each row carries the localized "N
   * seconds/minutes ago" relative time plus, for the channel
   * driving the device's online state, an "active" badge so the
   * user can tell which signal is authoritative. The Ping row
   * also surfaces the most recent round-trip in milliseconds.
   *
   * Hides itself when no signal has ever been observed (a
   * brand-new device that's never broadcast and never been
   * pinged) — the placeholder "Waiting for first signal…" text
   * goes there instead. "Signal" is source-neutral on purpose —
   * ping is a probe, not a broadcast, so the older
   * "first broadcast" wording was wrong for ping-source devices.
   * Suppresses the section entirely when the subscription is in
   * flight (no snapshot yet) so the drawer doesn't flash an
   * empty header.
   *
   * The three signal rows share enough shape that a small
   * declarative table drives them — the per-signal differences
   * are just (icon, label, age field, source name, optional rtt
   * field), and the row template handles the rest.
   */
  private _renderReachabilitySection() {
    const r = this._reachability;
    if (r === null) return nothing;

    // Use the same active locale as the rest of the UI — a user
    // who's overridden their language to ``fr`` or ``nl`` should
    // see "il y a 12 secondes" alongside the rest of the
    // localized chrome, not English seconds-ago lines from
    // ``navigator.language``.
    const lang = activeLocale();
    const now = Date.now();
    const anchor = this._reachabilityAnchorMs;

    // ``mdns_ttl_remaining_seconds`` is intentionally not
    // surfaced in the row. It came from the cached A record's
    // remaining TTL, which the backend's refresh loop drives
    // back to ~120s on every probe — so the displayed value
    // would mostly be a function of when our refresh tick last
    // fired, not "how soon the device's announce expires" the
    // way a naive reader would interpret it. The "Last seen"
    // age is the truthful diagnostic; TTL is internal plumbing.
    const rows: ReachabilityRowSpec[] = [
      {
        source: "mdns",
        icon: "access-point-network",
        labelKey: "dashboard.drawer_source_mdns",
        age: ageOf(r.mdns_last_seen_seconds_ago, anchor, now),
      },
      {
        source: "ping",
        icon: "lan",
        labelKey: "dashboard.drawer_source_ping",
        age: ageOf(r.ping_last_seen_seconds_ago, anchor, now),
        rttMs: r.ping_rtt_ms,
      },
      {
        source: "mqtt",
        icon: "message",
        labelKey: "dashboard.drawer_source_mqtt",
        age: ageOf(r.mqtt_last_seen_seconds_ago, anchor, now),
      },
    ];
    const anySignal = rows.some((row) => row.age !== null);

    return html`
      <div class="section">
        <h4 class="section-title">
          ${this._localize("dashboard.drawer_reachability")}
        </h4>
        ${!anySignal
          ? html`<div class="value muted">
              ${this._localize("dashboard.drawer_waiting_for_signal")}
            </div>`
          : rows.map((row) =>
              this._renderReachabilityRow(row, r.active_source, lang),
            )}
      </div>
    `;
  }

  private _renderReachabilityRow(
    row: ReachabilityRowSpec,
    activeSource: ReachabilitySource,
    lang: string | undefined,
  ) {
    if (row.age === null) return nothing;
    const ageText = formatSecondsAgo(row.age, lang);
    // RTT keeps 1 decimal — sub-millisecond precision is the
    // signal here (4.2 ms vs 4 ms is meaningful for a LAN ping).
    // Pull from the module-level cache so the 1Hz drawer
    // re-render doesn't churn one allocation per row per tick.
    const rttFmt = getNumberFormatter(lang, 1);
    const rttText =
      row.rttMs === null || row.rttMs === undefined
        ? null
        : this._localize("dashboard.drawer_round_trip_ms", {
            // Format the RTT through ``Intl.NumberFormat`` so the
            // decimal separator follows the active locale (French
            // expects ``1,4 ms`` not ``1.4 ms``). Ages already
            // localize via ``Intl.RelativeTimeFormat``; the RTT
            // suffix should match.
            n: rttFmt.format(row.rttMs),
          });
    const isActive = activeSource === row.source;
    return html`
      <div class="row">
        <div class="icon">
          <wa-icon library="mdi" name=${row.icon}></wa-icon>
        </div>
        <div class="content">
          <div class="label">
            ${this._localize(row.labelKey)}
            ${isActive
              ? html`<span class="reachability-badge"
                  >${this._localize("dashboard.drawer_source_active")}</span
                >`
              : nothing}
          </div>
          <div class="value">
            ${ageText}${rttText
              ? html` &middot; <span class="reachability-rtt">${rttText}</span>`
              : nothing}
          </div>
        </div>
      </div>
    `;
  }

  // ─── Reachability subscription lifecycle ───────────────────

  protected updated(changed: Map<string, unknown>) {
    super.updated?.(changed);
    /* The dashboard re-binds ``device`` to a fresh object on every
       ``DEVICE_UPDATED`` push (state flap, IP change, version
       change) so the drawer reflects the latest data without the
       user closing and reopening it. We only want the per-device
       resets / subscription churn when the drawer is actually
       being reused for a *different* device — a new
       configuration filename, or a transition from null to a
       device. Compare ``configuration`` rather than identity so
       same-device WS pushes don't reset ``_ipExpanded`` or rotate
       the reachability subscription. */
    const previousDevice = changed.get("device") as ConfiguredDevice | null | undefined;
    const deviceTargetMoved =
      changed.has("device") &&
      (previousDevice?.configuration ?? null) !==
        (this.device?.configuration ?? null);
    if (deviceTargetMoved) {
      // Per-device UI state must reset when the drawer is reused
      // for a new device — without this a user who expanded the
      // multi-IP row on device A would see device B's drawer open
      // already-expanded, contradicting the "collapsed by default"
      // contract.
      this._ipExpanded = false;
    }
    if (deviceTargetMoved || changed.has("drawerOpen") || changed.has("_api")) {
      this._reconcileReachabilitySubscription();
      // Run the tick whenever there's a *target* (drawer open +
      // device + api), independent of whether the subscribe
      // succeeded. The tick re-runs reconcile, so a failed
      // initial subscribe (WS not connected yet, server hiccup)
      // gets retried at 1Hz instead of leaving the
      // section permanently disabled until the user
      // closes/reopens the drawer.
      this._syncTickInterval();
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._teardownReachabilitySubscription();
    if (this._tickInterval !== null) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }
  }

  /** Open / close / swap the per-device reachability subscription
   *  to match (drawerOpen, device.name, api). Called from
   *  ``updated()`` whenever any of those move and from the 1Hz
   *  tick to catch WS reconnects (the API clears its event
   *  listeners on close, so a stale ``_subscribedDevice`` flag
   *  would otherwise prevent resubscribing on reconnect).
   *  Idempotent when the four inputs are unchanged from the
   *  active subscription. */
  private _reconcileReachabilitySubscription() {
    const wantName =
      this.drawerOpen && this.device && this._api ? this.device.name : null;
    const currentGeneration = this._api?.connectionGeneration ?? 0;
    // Resubscribe if the device target moved OR the WS reconnected
    // (which cleared ``_eventSubscriptions`` on the API side; without
    // a fresh subscribe our listener never sees another event).
    const generationChanged =
      this._subscribedDevice !== null &&
      currentGeneration !== this._subscribedGeneration;
    if (wantName === this._subscribedDevice && !generationChanged) return;

    this._teardownReachabilitySubscription();
    if (wantName === null || this._api === undefined) return;

    // Skip the retry if we already failed on this exact
    // (device, connection generation) tuple. Permanent errors
    // (NOT_FOUND, INVALID_ARGS) would otherwise re-fire
    // ``devices/subscribe_reachability`` every tick for as long
    // as the drawer stays open. A new device selection or a WS
    // reconnect both flip the key, so transient failures
    // self-heal on the natural progression.
    const targetKey = `${wantName}:${currentGeneration}`;
    if (this._failedSubscribeKey === targetKey) return;

    this._subscribedDevice = wantName;
    this._subscribedGeneration = currentGeneration;
    // Kick off the async subscribe — failures are logged but
    // don't propagate. The drawer still works without
    // reachability; the section just stays hidden. The
    // ``targetKey`` we just computed pins this attempt's
    // identity so the in-flight handler can tell whether its
    // resolve/reject still matches the current state when it
    // wakes up (a WS reconnect during the round trip would
    // otherwise let a stale rejection clobber the new
    // subscribe's bookkeeping).
    void this._openReachabilitySubscription(
      wantName,
      currentGeneration,
      targetKey,
      this._api,
    );
  }

  private async _openReachabilitySubscription(
    deviceName: string,
    attemptGeneration: number,
    attemptKey: string,
    api: ESPHomeAPI,
  ) {
    // Helper: is this attempt still the current one? A WS
    // reconnect (generation bump) or a different-device
    // selection between subscribe-start and resolve/reject
    // makes the attempt stale; in that case the catch path
    // must NOT mutate ``_failedSubscribeKey`` /
    // ``_subscribedDevice`` (those now belong to the newer
    // attempt) and the success path must unsubscribe.
    const isCurrent = (): boolean =>
      this._subscribedDevice === deviceName &&
      this._subscribedGeneration === attemptGeneration;

    try {
      const subscription = await api.subscribeDeviceReachability(
        deviceName,
        (state) => {
          // Drop late-arriving events from a stale subscription
          // — the user already swapped to a different device or
          // the WS reconnected and a fresher subscribe is now
          // the source of truth.
          if (!isCurrent()) return;
          this._reachability = state;
          this._reachabilityAnchorMs = Date.now();
        },
      );
      if (!isCurrent()) {
        // User moved on or the WS cycled while our subscribe
        // was in flight — tear this just-created subscription
        // down without touching the newer attempt's state.
        void subscription.unsubscribe();
        return;
      }
      this._subscription = subscription;
      // Successful subscribe — clear any stale "we already failed
      // on this (device, gen)" gate so a future drop from this
      // session can retry.
      this._failedSubscribeKey = null;
    } catch (err) {
      // Rate-limit the warning: the 1Hz tick re-runs reconcile,
      // and during a WS-not-yet-connected window each retry
      // would also fail and log. Without the gate the console
      // fills with "subscribeDeviceReachability failed" once
      // a second until the WS comes back. Key on (device,
      // generation) of *this* attempt so each new device or
      // each reconnect logs exactly once.
      if (this._loggedFailureKey !== attemptKey) {
        this._loggedFailureKey = attemptKey;
        // eslint-disable-next-line no-console
        console.warn("subscribeDeviceReachability failed", err);
      }
      // Only pin the failure key + clear ``_subscribedDevice``
      // if this attempt is still the current one. A stale
      // rejection (the WS cycled during our await) belongs
      // to a previous attempt; mutating now would (a) clobber
      // the newer subscribe's bookkeeping and (b) pin
      // ``_failedSubscribeKey`` against a generation that's
      // already been superseded, blocking legitimate retries.
      if (isCurrent()) {
        this._failedSubscribeKey = attemptKey;
        this._subscribedDevice = null;
      }
    }
  }

  private _teardownReachabilitySubscription() {
    this._subscribedDevice = null;
    this._reachability = null;
    this._reachabilityAnchorMs = 0;
    if (this._subscription !== null) {
      const sub = this._subscription;
      this._subscription = null;
      void sub.unsubscribe();
    }
  }

  /** Match the 1Hz tick to whether there's a target. Called from
   *  ``updated()`` and ``disconnectedCallback`` so the tick runs
   *  while the drawer is open with a device, regardless of
   *  whether the subscription itself succeeded — a failed initial
   *  subscribe (WS not connected yet, server hiccup) gets
   *  retried via the tick's reconcile call rather than leaving
   *  the section permanently disabled. */
  private _syncTickInterval() {
    const wantTick = this.drawerOpen && this.device !== undefined && this._api !== undefined;
    if (wantTick && this._tickInterval === null) {
      // 1Hz: the displayed values (relative-time string, integer
      // TTL seconds) only resolve at second precision, so a 2Hz
      // tick was just rendering the same string twice. Anything
      // slower than 1s would let the seconds-ago display lag a
      // beat behind reality. The reconcile probe inside the tick
      // doesn't need millisecond precision either.
      this._tickInterval = setInterval(() => {
        this._tick = (this._tick + 1) % 1000;
        // Probe for WS reconnect / failed-initial-subscribe on
        // every tick. ``api`` clears its event listeners on
        // close (``_onClose`` → ``_eventSubscriptions.clear``),
        // so on reconnect our listener is gone but
        // ``_subscribedDevice`` still says we think we're
        // subscribed; reconciling here re-detects the
        // generation bump and resubscribes. The tick also
        // retries an initial subscribe that failed (e.g. the
        // WS wasn't open yet when the drawer first rendered).
        this._reconcileReachabilitySubscription();
      }, 1000);
    } else if (!wantTick && this._tickInterval !== null) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }
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
