import { html, nothing, type TemplateResult } from "lit";
import type { ConfiguredDevice } from "../../../api/types.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { formatFileSize } from "../../../util/format-file-size.js";
import { splitIntegrations } from "../../../util/integration-split.js";
import { buildWebUiUrl } from "../../../util/web-ui-url.js";
import { renderIpValue } from "../device-drawer-render.js";
import type { ESPHomeDeviceDrawerContent } from "../device-drawer-content.js";

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
  mono = false
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
          ${value || "—"}
        </div>
      </div>
    </div>
  `;
}

export function renderEncryptionBadge(
  localize: LocalizeFunc,
  state: "active" | "plaintext" | "pending" | "mismatch" | "none"
): TemplateResult | typeof nothing {
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
  return html`<span class="status-badge ${v.cls}" title=${localize(v.titleKey)}>
    <wa-icon library="mdi" name=${v.icon}></wa-icon>
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
      ${indirect.length > 0
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
        : nothing}
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
  const deployed = d.deployed_version || "";
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
      ${showStatus
        ? html`<div class=${statusCls}>
            <wa-icon library="mdi" name=${statusIcon}></wa-icon>
            <span>${localize(statusKey)}</span>
          </div>`
        : nothing}
      ${matches
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
              true
            )}
          `}
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
  const deployed = d.deployed_config_hash || "";
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
      ${showStatus
        ? html`<div class=${statusCls}>
            <wa-icon library="mdi" name=${statusIcon}></wa-icon>
            <span>${localize(statusKey)}</span>
          </div>`
        : nothing}
      ${matches
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
              true
            )}
          `}
    </div>
  `;
}

// Single IP renders as a plain row; multi-IP (IPv6+IPv4) collapses to the
// primary with a chevron toggle so the drawer stays scannable.
export function renderIpAddressRow(
  host: ESPHomeDeviceDrawerContent,
  d: ConfiguredDevice
): TemplateResult {
  const list = d.ip_addresses;
  const label = host._localize("dashboard.drawer_ip_address");
  const webUrl = buildWebUiUrl(d);
  if (list.length === 0) {
    if (!webUrl) return renderRow("ip-network-outline", label, "", true);
    return html`
      <div class="row">
        <div class="icon">
          <wa-icon library="mdi" name="ip-network-outline"></wa-icon>
        </div>
        <div class="content">
          <div class="label">${label}</div>
          ${renderIpValue("", webUrl, host._localize)}
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
          ${renderIpValue(list[0], webUrl, host._localize)}
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
        ${renderIpValue(list[0], webUrl, host._localize)}
        ${expanded
          ? list.slice(1).map((ip) => html`<div class="value mono">${ip}</div>`)
          : nothing}
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
          ${expanded
            ? host._localize("dashboard.drawer_ip_hide_extra")
            : host._localize("dashboard.drawer_ip_show_more", { n: extra })}
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
    true
  );
}

// Hidden when YAML doesn't load ethernet or the derived value duplicates mac_address
// (single-MAC RP2040 / RP2350 platforms).
export function renderEthernetMacRow(
  d: ConfiguredDevice,
  localize: LocalizeFunc
): TemplateResult | typeof nothing {
  if (!d.ethernet_mac || d.ethernet_mac === d.mac_address) return nothing;
  return renderRow(
    "ethernet",
    localize("dashboard.drawer_ethernet_mac"),
    d.ethernet_mac,
    true
  );
}

export function renderBluetoothMacRow(
  d: ConfiguredDevice,
  localize: LocalizeFunc
): TemplateResult | typeof nothing {
  if (!d.bluetooth_mac || d.bluetooth_mac === d.mac_address) return nothing;
  return renderRow(
    "bluetooth",
    localize("dashboard.drawer_bluetooth_mac"),
    d.bluetooth_mac,
    true
  );
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
            title=${host.busy
              ? host._localize("dashboard.action_clean_build_busy")
              : host._localize("dashboard.action_clean_build")}
            aria-label=${host.busy
              ? host._localize("dashboard.action_clean_build_busy")
              : host._localize("dashboard.action_clean_build")}
            @click=${() => (host.busy ? null : emitCleanBuild(host, d))}
          >
            <wa-icon library="mdi" name="broom"></wa-icon>
          </button>
        </div>
      </div>
    </div>
  `;
}
