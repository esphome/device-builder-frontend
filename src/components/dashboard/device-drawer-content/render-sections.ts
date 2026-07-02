import { html, nothing, type TemplateResult } from "lit";
import type { ConfiguredDevice } from "../../../api/types/devices.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { mdnsOnline } from "../../../util/device-sync.js";
import {
  getEncryptionVisual,
  type EncryptionState,
} from "../../../util/encryption-state.js";
import { formatFileSize } from "../../../util/format-file-size.js";
import { splitIntegrations } from "../../../util/integration-split.js";
import { buildWebUiUrlForHost } from "../../../util/web-ui-url.js";
import type { ESPHomeDeviceDrawerContent } from "../device-drawer-content.js";
import { renderAddressValue } from "../device-drawer-render.js";

// Whitelist docs URLs to https://esphome.io. The map is backend-populated;
// a compromised entry interpolating a javascript: / data: scheme would run
// code on click, so bound the rendered anchors to the canonical host.
function isSafeDocsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "esphome.io";
  } catch {
    return false;
  }
}

export function renderRow(
  icon: string,
  label: string,
  value: string | null,
  mono = false,
  emptyText = "—"
): TemplateResult {
  const empty = !value;
  return html`
    <div class="row">
      <div class="icon">
        <wa-icon library="mdi" name=${icon}></wa-icon>
      </div>
      <div class="content">
        <div class="label">${label}</div>
        <div class="value ${mono ? "mono" : ""} ${empty ? "muted" : ""}">
          ${value || emptyText}
        </div>
      </div>
    </div>
  `;
}

export function renderEncryptionBadge(
  localize: LocalizeFunc,
  state: EncryptionState
): TemplateResult | typeof nothing {
  const v = getEncryptionVisual(state);
  if (!v) return nothing;
  return html`<span class="status-badge ${v.badgeClass}" title=${localize(v.tooltipKey)}>
    <wa-icon library="mdi" name=${v.iconName}></wa-icon>
    ${localize(v.labelKey)}
  </span>`;
}

function renderIntegrationTag(
  name: string,
  integrationDocs: Record<string, string>
): TemplateResult {
  const url = integrationDocs[name];
  return url && isSafeDocsUrl(url)
    ? html`<a class="tag tag--link" href=${url} target="_blank" rel="noopener noreferrer"
        >${name}</a
      >`
    : html`<span class="tag">${name}</span>`;
}

// loaded_integrations lumps user-written entries with the AUTO_LOAD chain
// they drag in. Backend's directly_referenced_integrations is the user's
// subset (#422); the complement is auto-loaded — tuck those inside <details>
// so the primary chip row stays scannable.
export function renderLoadedIntegrationsSection(
  d: ConfiguredDevice,
  localize: LocalizeFunc,
  integrationDocs: Record<string, string>
): TemplateResult | typeof nothing {
  if (!d.loaded_integrations || d.loaded_integrations.length === 0) {
    return nothing;
  }
  const { direct, indirect } = splitIntegrations(
    d.loaded_integrations,
    d.directly_referenced_integrations
  );
  return html`
    <div class="section">
      <h4 class="section-title">${localize("dashboard.drawer_loaded_integrations")}</h4>
      <div class="tags-wrap">
        ${direct.map((i) => renderIntegrationTag(i, integrationDocs))}
      </div>
      ${
        indirect.length > 0
          ? html`
              <details class="auto-loaded-details">
                <summary>
                  ${localize("dashboard.drawer_auto_loaded_integrations", {
                    count: String(indirect.length),
                  })}
                </summary>
                <div class="tags-wrap tags-wrap--auto-loaded">
                  ${indirect.map((i) => renderIntegrationTag(i, integrationDocs))}
                </div>
              </details>
            `
          : nothing
      }
    </div>
  `;
}

export function renderLabelsSection(
  d: ConfiguredDevice,
  localize: LocalizeFunc
): TemplateResult {
  return html`
    <div class="section">
      <h4 class="section-title">${localize("dashboard.drawer_labels")}</h4>
      <esphome-device-labels-editor .device=${d}></esphome-device-labels-editor>
    </div>
  `;
}

// Local-vs-deployed ESPHome version. Pair tells "device up-to-date with the
// dashboard's toolchain" from "device runs an older release that hasn't been
// re-flashed since the dashboard upgrade". Skipped when neither side has
// reported yet (brand-new device, never compiled, never broadcast).
export function renderVersionSection(
  d: ConfiguredDevice,
  localize: LocalizeFunc
): TemplateResult | typeof nothing {
  const local = d.current_version || "";
  // The deployed version comes only from mDNS; when mDNS is dark it's stale, so
  // treat it as unknown and let the existing empty-deployed path show
  // "waiting for mDNS" instead of a false "out of sync".
  const deployed = mdnsOnline(d) ? d.deployed_version || "" : "";
  if (!local && !deployed) return nothing;
  const matches = !!local && !!deployed && local === deployed;
  const statusIcon = matches ? "check-circle-outline" : "sync";
  const statusKey = matches
    ? "dashboard.drawer_version_in_sync"
    : "dashboard.drawer_version_out_of_sync";
  const statusCls = matches
    ? "sync-status sync-status--match"
    : "sync-status sync-status--diff";
  const showStatus = !!local && !!deployed;
  return html`
    <div class="section">
      <h4 class="section-title">${localize("dashboard.drawer_version")}</h4>
      ${
        showStatus
          ? html`<div class=${statusCls}>
              <wa-icon library="mdi" name=${statusIcon}></wa-icon>
              <span>${localize(statusKey)}</span>
            </div>`
          : nothing
      }
      ${
        matches
          ? renderRow("tag-multiple", localize("dashboard.drawer_version"), local, true)
          : html`
              ${renderRow(
                "tag-multiple",
                localize("dashboard.drawer_current_version"),
                local,
                true
              )}
              ${renderRow(
                "upload",
                localize("dashboard.drawer_deployed_version"),
                deployed,
                true,
                localize("dashboard.drawer_waiting_for_mdns")
              )}
            `
      }
    </div>
  `;
}

// Local-vs-deployed config hash. Surfaces the diagnostic answer to
// "the modified dot is on but the YAML hasn't changed — what's mismatched?".
export function renderConfigHashSection(
  d: ConfiguredDevice,
  localize: LocalizeFunc
): TemplateResult | typeof nothing {
  const expected = d.expected_config_hash || "";
  // mDNS-sourced; treat as unknown when mDNS is dark (see renderVersionSection).
  const deployed = mdnsOnline(d) ? d.deployed_config_hash || "" : "";
  if (!expected && !deployed) return nothing;
  const matches = !!expected && !!deployed && expected === deployed;
  const statusIcon = matches ? "check-circle-outline" : "sync";
  const statusKey = matches
    ? "dashboard.drawer_config_hash_in_sync"
    : "dashboard.drawer_config_hash_out_of_sync";
  const statusCls = matches
    ? "sync-status sync-status--match"
    : "sync-status sync-status--diff";
  const showStatus = !!expected && !!deployed;
  return html`
    <div class="section">
      <h4 class="section-title">${localize("dashboard.drawer_config_hash_title")}</h4>
      ${
        showStatus
          ? html`<div class=${statusCls}>
              <wa-icon library="mdi" name=${statusIcon}></wa-icon>
              <span>${localize(statusKey)}</span>
            </div>`
          : nothing
      }
      ${
        matches
          ? renderRow(
              "fingerprint",
              localize("dashboard.drawer_config_hash_value"),
              expected,
              true
            )
          : html`
              ${renderRow(
                "fingerprint",
                localize("dashboard.drawer_config_hash_local"),
                expected,
                true
              )}
              ${renderRow(
                "fingerprint",
                localize("dashboard.drawer_config_hash_deployed"),
                deployed,
                true,
                localize("dashboard.drawer_waiting_for_mdns")
              )}
            `
      }
    </div>
  `;
}

// The hostname row's visit link points at the hostname (http://<name>.local).
export function renderHostnameRow(
  host: ESPHomeDeviceDrawerContent,
  d: ConfiguredDevice
): TemplateResult {
  return html`
    <div class="row">
      <div class="icon">
        <wa-icon library="mdi" name="network-outline"></wa-icon>
      </div>
      <div class="content">
        <div class="label">${host._localize("dashboard.drawer_hostname")}</div>
        ${renderAddressValue(
          d.address,
          buildWebUiUrlForHost(d.address, d.web_port),
          host._localize
        )}
      </div>
    </div>
  `;
}

// Single IP renders as a plain row; multi-IP (IPv6+IPv4) collapses to the
// primary with a chevron toggle. Each IP's visit link points at that IP.
export function renderIpAddressRow(
  host: ESPHomeDeviceDrawerContent,
  d: ConfiguredDevice
): TemplateResult {
  const list = d.ip_addresses;
  const label = host._localize("dashboard.drawer_ip_address");
  // ip_addresses isn't persisted across restarts but the primary d.ip is, so
  // fall back to it on a cold scan to keep the IP row and its visit link.
  const primary = list[0] ?? d.ip;
  if (!primary) {
    // IP is learned from any source (mDNS / ping), not only mDNS, so mirror
    // the reachability section's "Waiting for first signal" wording.
    return renderRow(
      "ip-network-outline",
      label,
      "",
      true,
      host._localize("dashboard.drawer_waiting_for_signal")
    );
  }
  if (list.length <= 1) {
    return html`
      <div class="row">
        <div class="icon">
          <wa-icon library="mdi" name="ip-network-outline"></wa-icon>
        </div>
        <div class="content">
          <div class="label">${label}</div>
          ${renderAddressValue(
            primary,
            buildWebUiUrlForHost(primary, d.web_port),
            host._localize
          )}
        </div>
      </div>
    `;
  }
  const expanded = host._ipExpanded;
  const extra = list.length - 1;
  return html`
    <div class="row">
      <div class="icon">
        <wa-icon library="mdi" name="ip-network-outline"></wa-icon>
      </div>
      <div class="content">
        <div class="label">${label}</div>
        ${renderAddressValue(
          list[0],
          buildWebUiUrlForHost(list[0], d.web_port),
          host._localize
        )}
        ${
          expanded
            ? list
                .slice(1)
                .map((ip) =>
                  renderAddressValue(
                    ip,
                    buildWebUiUrlForHost(ip, d.web_port),
                    host._localize
                  )
                )
            : nothing
        }
        <button
          class="ip-toggle"
          type="button"
          aria-expanded=${expanded}
          @click=${() => {
            host._ipExpanded = !host._ipExpanded;
          }}
        >
          <wa-icon
            library="mdi"
            name=${expanded ? "chevron-up" : "chevron-down"}
          ></wa-icon>
          ${
            expanded
              ? host._localize("dashboard.drawer_ip_hide_extra")
              : host._localize("dashboard.drawer_ip_show_more", { n: extra })
          }
        </button>
      </div>
    </div>
  `;
}

export function renderMacAddressRow(
  d: ConfiguredDevice,
  localize: LocalizeFunc
): TemplateResult {
  return renderRow(
    "ethernet",
    localize("dashboard.drawer_mac_address"),
    d.mac_address,
    true,
    localize("dashboard.drawer_waiting_for_mdns")
  );
}

// Mirrors the backend's mac_addresses._has_ethernet / _has_bluetooth: which
// interface MACs the YAML loads. Used only to show a "waiting" row before the
// primary MAC is observed (the derived value is empty until then); once the
// primary MAC is present the derived value itself tells us whether the platform
// has a distinct MAC.
const deviceHasEthernet = (d: ConfiguredDevice): boolean =>
  d.loaded_integrations.includes("ethernet");
const deviceHasBluetooth = (d: ConfiguredDevice): boolean =>
  d.loaded_integrations.some(
    (n) => n.startsWith("esp32_ble") || n.startsWith("bluetooth_")
  );

// Show the distinct derived MAC when known; while the primary MAC is still
// pending mDNS, show a "waiting" row if the YAML loads the interface; otherwise
// hide (no such interface, or a single-MAC platform whose derived value just
// duplicates mac_address).
export function renderEthernetMacRow(
  d: ConfiguredDevice,
  localize: LocalizeFunc
): TemplateResult | typeof nothing {
  if (d.ethernet_mac && d.ethernet_mac !== d.mac_address) {
    return renderRow(
      "ethernet",
      localize("dashboard.drawer_ethernet_mac"),
      d.ethernet_mac,
      true
    );
  }
  if (!d.mac_address && deviceHasEthernet(d)) {
    return renderRow(
      "ethernet",
      localize("dashboard.drawer_ethernet_mac"),
      "",
      true,
      localize("dashboard.drawer_waiting_for_mdns")
    );
  }
  return nothing;
}

export function renderBluetoothMacRow(
  d: ConfiguredDevice,
  localize: LocalizeFunc
): TemplateResult | typeof nothing {
  if (d.bluetooth_mac && d.bluetooth_mac !== d.mac_address) {
    return renderRow(
      "bluetooth",
      localize("dashboard.drawer_bluetooth_mac"),
      d.bluetooth_mac,
      true
    );
  }
  if (!d.mac_address && deviceHasBluetooth(d)) {
    return renderRow(
      "bluetooth",
      localize("dashboard.drawer_bluetooth_mac"),
      "",
      true,
      localize("dashboard.drawer_waiting_for_mdns")
    );
  }
  return nothing;
}

function emitCleanBuild(
  host: ESPHomeDeviceDrawerContent,
  device: ConfiguredDevice
): void {
  host.dispatchEvent(
    new CustomEvent("clean-build", {
      detail: device,
      bubbles: true,
      composed: true,
    })
  );
}

// Build-size row with inline "Clean" button. Hidden on never-compiled devices
// (build_size_bytes=0). Clean bubbles a clean-build event up to dashboard.ts,
// which routes through the same _openCommand(device, "clean") path as the
// kebab — same backend job, same job-completion build-size refresh hook.
export function renderBuildSizeRow(
  host: ESPHomeDeviceDrawerContent,
  d: ConfiguredDevice
): TemplateResult | typeof nothing {
  if (!d.build_size_bytes) return nothing;
  return html`
    <div class="row">
      <div class="icon">
        <wa-icon library="mdi" name="harddisk"></wa-icon>
      </div>
      <div class="content">
        <div class="label">${host._localize("dashboard.drawer_build_size")}</div>
        <div class="value build-size-value">
          <span>${formatFileSize(d.build_size_bytes)}</span>
          <button
            class="build-size-clean ${host.busy ? "build-size-clean--disabled" : ""}"
            type="button"
            aria-disabled=${host.busy ? "true" : "false"}
            title=${
              host.busy
                ? host._localize("dashboard.action_clean_build_busy")
                : host._localize("dashboard.action_clean_build")
            }
            aria-label=${
              host.busy
                ? host._localize("dashboard.action_clean_build_busy")
                : host._localize("dashboard.action_clean_build")
            }
            @click=${() => (host.busy ? null : emitCleanBuild(host, d))}
          >
            <wa-icon library="mdi" name="broom"></wa-icon>
          </button>
        </div>
      </div>
    </div>
  `;
}
