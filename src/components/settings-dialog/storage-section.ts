import { consume } from "@lit/context";
import { mdiAlertOutline, mdiCogRefresh } from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";

import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { DiskUsage } from "../../api/types/system.js";
import type { LocalizeFunc } from "../../common/localize.js";
import {
  devicesContext,
  diskUsageContext,
  localizeContext,
} from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import {
  type DiskSegment,
  diskSegments,
  isDiskSpaceLow,
  percentOf,
  toolchainAndCacheBytes,
} from "../../util/disk-usage.js";
import { fireEvent } from "../../util/fire-event.js";
import { formatFileSize } from "../../util/format-file-size.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { renderStatusRow } from "./settings-rows.js";
import { settingsRowStyles, settingsSharedStyles } from "./shared-styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ "alert-outline": mdiAlertOutline, "cog-refresh": mdiCogRefresh });

// Rows listed under Device builds; the total covers every build.
const LARGEST_BUILDS = 5;

const SEGMENT_LABEL_KEYS: Record<DiskSegment["key"], string> = {
  builds: "settings.storage_builds",
  toolchains: "settings.storage_toolchains",
  remote_builds: "settings.storage_remote_builds",
  config: "settings.storage_config",
  other: "settings.storage_other",
};

@customElement("esphome-settings-storage")
export class ESPHomeSettingsStorage extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: diskUsageContext, subscribe: true })
  @state()
  private _usage: DiskUsage | null = null;

  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  static styles = [
    espHomeStyles,
    settingsSharedStyles,
    settingsRowStyles,
    css`
      .summary {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--wa-space-s);
        margin-bottom: var(--wa-space-xs);
      }
      .summary-free {
        font-size: var(--wa-font-size-l);
        font-weight: var(--wa-font-weight-bold);
      }
      .summary-total,
      .legend {
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
      }
      .bar {
        display: flex;
        height: 12px;
        border-radius: 6px;
        overflow: hidden;
        background: var(--wa-color-surface-border);
      }
      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wa-space-2xs) var(--wa-space-m);
        margin: var(--wa-space-s) 0 0;
        padding: 0;
        list-style: none;
      }
      .swatch {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 2px;
        margin-inline-end: 4px;
      }
      .seg--builds {
        background: var(--esphome-primary);
      }
      .seg--toolchains {
        background: var(--wa-color-orange-60);
      }
      .seg--remote_builds {
        background: var(--wa-color-purple-60);
      }
      .seg--config {
        background: var(--wa-color-green-60);
      }
      .seg--other {
        background: var(--wa-color-gray-60);
      }
      .seg--free {
        background: var(--wa-color-surface-border);
      }
      .alert {
        display: flex;
        gap: var(--wa-space-s);
        align-items: flex-start;
        padding: var(--wa-space-s) var(--wa-space-m);
        margin-bottom: var(--wa-space-m);
        border-radius: var(--wa-border-radius-m);
        background: var(--wa-color-warning-fill-quiet);
        color: var(--wa-color-warning-on-quiet);
        font-size: var(--wa-font-size-s);
        line-height: 1.4;
      }
      .alert wa-icon {
        flex-shrink: 0;
        font-size: 1.2em;
      }
      .size {
        font-size: var(--wa-font-size-s);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .row-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-m);
      }
      .builds {
        margin: 0;
        padding: 0;
        list-style: none;
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
      }
      .builds li {
        display: flex;
        justify-content: space-between;
        gap: var(--wa-space-s);
        padding: 2px 0;
      }
      .builds li span:first-child {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .reset-btn {
        align-self: flex-start;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        background: none;
        color: inherit;
        font: inherit;
        font-size: var(--wa-font-size-xs);
        cursor: pointer;
        white-space: nowrap;
      }
      .reset-btn:hover {
        background: var(--wa-color-surface-lowered);
      }
    `,
  ];

  protected render() {
    const usage = this._usage;
    if (usage === null)
      return renderStatusRow(this._localize, "settings.storage_measuring");
    return html`
      <h3 class="section-heading">${this._localize("settings.storage_disk")}</h3>
      ${this._renderLowSpace(usage)}
      <div class="summary">
        <span class="summary-free">
          ${this._localize("settings.storage_free", { size: formatFileSize(usage.free_bytes) })}
        </span>
        <span class="summary-total">
          ${this._localize("settings.storage_total", { size: formatFileSize(usage.total_bytes) })}
        </span>
      </div>
      ${this._renderBar(usage)}
      <h3 class="section-heading">
        ${this._localize("settings.storage_used_by_esphome")}
      </h3>
      ${this._renderBuilds(usage)}
      <div class="row row--stacked">
        <div class="row-head">
          <div class="row-label">
            <span class="row-title"
              >${this._localize("settings.storage_toolchains")}</span
            >
            <span class="row-desc"
              >${this._localize("settings.storage_toolchains_desc")}</span
            >
          </div>
          <span class="size">${formatFileSize(toolchainAndCacheBytes(usage))}</span>
        </div>
        <button class="reset-btn" @click=${this._onResetBuildEnv}>
          <wa-icon library="mdi" name="cog-refresh"></wa-icon>
          ${this._localize("layout.reset_build_env")}
        </button>
      </div>
      ${
        usage.remote_builds_bytes > 0
          ? this._renderSizeRow(
              "settings.storage_remote_builds",
              "settings.storage_remote_builds_desc",
              usage.remote_builds_bytes
            )
          : nothing
      }
      ${this._renderSizeRow(
        "settings.storage_config",
        "settings.storage_config_desc",
        usage.config_bytes
      )}
    `;
  }

  private _renderLowSpace(usage: DiskUsage) {
    if (!isDiskSpaceLow(usage)) return nothing;
    return html`
      <div class="alert" role="alert">
        <wa-icon library="mdi" name="alert-outline"></wa-icon>
        <span>
          ${this._localize("settings.storage_low", { size: formatFileSize(usage.free_bytes) })}
        </span>
      </div>
    `;
  }

  private _renderBar(usage: DiskUsage) {
    const segments = diskSegments(usage);
    const label = this._localize("settings.storage_bar_aria", {
      free: formatFileSize(usage.free_bytes),
      total: formatFileSize(usage.total_bytes),
    });
    return html`
      <div class="bar" role="img" aria-label=${label}>
        ${segments.map(
          (s) =>
            html`<span
              class="seg--${s.key}"
              style=${styleMap({ width: `${percentOf(s.bytes, usage.total_bytes)}%` })}
            ></span>`
        )}
      </div>
      <ul class="legend">
        ${segments.map(
          (s) =>
            html`<li>
              <span class="swatch seg--${s.key}" aria-hidden="true"></span
              >${this._localize(SEGMENT_LABEL_KEYS[s.key])} ${formatFileSize(s.bytes)}
            </li>`
        )}
        <li>
          <span class="swatch seg--free" aria-hidden="true"></span
          >${this._localize("settings.storage_free_legend")}
          ${formatFileSize(usage.free_bytes)}
        </li>
      </ul>
    `;
  }

  private _renderBuilds(usage: DiskUsage) {
    const built = this._builtDevices();
    return html`
      <div class="row row--stacked">
        <div class="row-head">
          <div class="row-label">
            <span class="row-title">${this._localize("settings.storage_builds")}</span>
            <span class="row-desc">
              ${this._localize("settings.storage_builds_desc", { count: built.length })}
            </span>
          </div>
          <span class="size">${formatFileSize(usage.builds_bytes)}</span>
        </div>
        ${
          built.length > 0
            ? html`<ul class="builds">
                ${built.slice(0, LARGEST_BUILDS).map(
                  (d) =>
                    html`<li>
                      <span>${d.friendly_name || d.name}</span>
                      <span class="size">${formatFileSize(d.build_size_bytes)}</span>
                    </li>`
                )}
              </ul>`
            : nothing
        }
      </div>
    `;
  }

  private _renderSizeRow(titleKey: string, descKey: string, bytes: number) {
    return html`
      <div class="row">
        <div class="row-label">
          <span class="row-title">${this._localize(titleKey)}</span>
          <span class="row-desc">${this._localize(descKey)}</span>
        </div>
        <span class="size">${formatFileSize(bytes)}</span>
      </div>
    `;
  }

  /** Devices with a build on disk, largest first. */
  private _builtDevices(): ConfiguredDevice[] {
    return this._devices
      .filter((d) => d.build_size_bytes > 0)
      .sort((a, b) => b.build_size_bytes - a.build_size_bytes);
  }

  private _onResetBuildEnv() {
    fireEvent(this, "open-reset-build-env");
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-settings-storage": ESPHomeSettingsStorage;
  }
}
