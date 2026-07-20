/**
 * The render body's three branches: bare platform-domain catalog miss,
 * YAML-only section, and the structured config-entry form.
 */
import { html, nothing } from "lit";
import type { ConfigEntry } from "../../../api/types/config-entries.js";
// The value imports (isSecuritySection / isDeprecationSection) already execute
// the modules, registering the notice elements — no separate side-effect
// imports needed.
import { isDeprecationSection } from "../deprecation-notice.js";
import type { ESPHomeDeviceSectionConfig } from "../device-section-config.js";
import { isSecuritySection } from "../security-notice.js";
import type { SectionConfigResponse } from "./loading.js";
import {
  renderActionFieldsTable,
  renderActionsRow,
  renderApiActionsTable,
  renderNotice,
  renderTriggersTable,
} from "./render-tables.js";

import "../config-entry-form.js";

export interface StructuredFormOpts {
  config: SectionConfigResponse;
  renderEntries: ConfigEntry[];
  showAdvanced: boolean;
  canDelete: boolean;
}

export function renderPlatformDomainBranch(
  host: ESPHomeDeviceSectionConfig,
  canDelete: boolean
) {
  return html`${renderNotice(html`
    <p>
      ${host._localize("device.platform_domain_section", {
        key: host.sectionKey,
      })}
    </p>
    <button type="button" class="yaml-only-notice-cta" @click=${host._onAddPlatform}>
      ${host._localize("device.id_reference_add", {
        domain: host.sectionKey,
      })}
    </button>
  `)}
  ${renderActionsRow(host, canDelete)}`;
}

export function renderYamlOnlyBranch(
  host: ESPHomeDeviceSectionConfig,
  canDelete: boolean
) {
  return html`${renderNotice(html`
    <p>${host._localize("device.yaml_only_section")}</p>
    ${
      host.yamlPaneVisible
        ? nothing
        : html`<button
            type="button"
            class="yaml-only-notice-cta"
            @click=${host._onShowYamlEditor}
          >
            ${host._localize("device.show_yaml_editor")}
          </button>`
    }
  `)}
  ${renderApiActionsTable(host)} ${renderTriggersTable(host)}
  ${renderActionFieldsTable(host)} ${renderActionsRow(host, canDelete)}`;
}

export function renderStructuredFormBranch(
  host: ESPHomeDeviceSectionConfig,
  { config, renderEntries, showAdvanced, canDelete }: StructuredFormOpts
) {
  return html`
    ${
      isSecuritySection(host.sectionKey)
        ? html`<esphome-security-notice
            .sectionKey=${host.sectionKey}
            .yaml=${host.yaml}
            .configuration=${host.configuration}
            .fromLine=${host._resolvedFromLine}
            @apply-section-values=${host._onApplySectionValues}
          ></esphome-security-notice>`
        : nothing
    }
    ${
      isDeprecationSection(host.sectionKey)
        ? html`<esphome-deprecation-notice
            .sectionKey=${host.sectionKey}
            .values=${host._values}
            .entries=${renderEntries}
            @apply-section-values=${host._onApplySectionValues}
          ></esphome-deprecation-notice>`
        : nothing
    }
    <esphome-config-entry-form
      .entries=${renderEntries}
      .requiredGroups=${config.required_groups}
      .values=${host._values}
      .errors=${host._mergeErrors(
        host.backendErrors.fields,
        host._clearedBackendPaths,
        host._fieldErrors
      )}
      .board=${host.board}
      .yaml=${host.yaml}
      .fromLine=${host._resolvedFromLine}
      .sectionKey=${host.sectionKey}
      .configuration=${host.configuration}
      .focusFieldPath=${host.focusFieldPath}
      .presentComponents=${host._presentComponents}
      advanced-section
      gate-advanced
      ?show-advanced=${showAdvanced}
      @value-change=${host._onValueChange}
      @advanced-toggle=${host._onAdvancedToggle}
      @edit-action-field=${host._onEditActionField}
    ></esphome-config-entry-form>
    ${host._error ? html`<p class="error">${host._error}</p>` : nothing}
    ${renderApiActionsTable(host)} ${renderTriggersTable(host)}
    ${renderActionsRow(host, canDelete)}
  `;
}
