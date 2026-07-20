/**
 * Per-section dialogs: add api action, add automation, delete confirm.
 * The host owns the ``@query`` refs and open/confirm handlers.
 */
import { html, nothing } from "lit";
import type { ESPHomeDeviceSectionConfig } from "../device-section-config.js";
import type { SectionConfigResponse } from "./loading.js";

import "../../confirm-dialog.js";
import "../add-api-action-dialog.js";
import "../add-automation-dialog.js";

export function renderApiActionDialog(host: ESPHomeDeviceSectionConfig) {
  if (host.sectionKey !== "api") return nothing;
  return html`<esphome-add-api-action-dialog
    .boardName=${host.boardName}
    .configuration=${host.configuration}
    .board=${host.board}
    .yaml=${host.yaml}
    @automation-added=${host._onApiActionAdded}
  ></esphome-add-api-action-dialog>`;
}

export function renderAddAutomationDialog(host: ESPHomeDeviceSectionConfig) {
  if (host._shortcutTarget() === null) {
    return nothing;
  }
  return html`<esphome-add-automation-dialog
    .boardName=${host.boardName}
    .configuration=${host.configuration}
    .board=${host.board}
    .yaml=${host.yaml}
    @automation-added=${host._onAutomationAdded}
  ></esphome-add-automation-dialog>`;
}

export function renderDeleteConfirmDialog(
  host: ESPHomeDeviceSectionConfig,
  canDelete: boolean,
  config: SectionConfigResponse
) {
  if (!canDelete) return nothing;
  return html`<esphome-confirm-dialog
    heading=${host._localize("device.delete_section")}
    confirm-label=${host._localize("device.delete_section")}
    message=${host._localize("device.confirm_delete_section", {
      name: config.title,
    })}
    destructive
    @confirm=${host._onDeleteConfirmed}
  ></esphome-confirm-dialog>`;
}
