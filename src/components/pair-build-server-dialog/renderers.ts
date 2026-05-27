import { html, nothing, type TemplateResult } from "lit";
import { formatPinSha256 } from "../../util/pin-format.js";
import {
  friendlyHostname,
  parsePortInput,
  trimTrailingDot,
} from "../../util/hostname.js";
import type { ESPHomePairBuildServerDialog } from "../pair-build-server-dialog.js";

export function renderInputStep(host: ESPHomePairBuildServerDialog): TemplateResult {
  const portValid = parsePortInput(host._port) !== null;
  const canSubmit = !host._busy && host._hostname.trim().length > 0 && portValid;
  return html`
    <div class="description">
      ${host._localize("settings.pair_build_server_input_desc")}
    </div>
    <div class="row">
      <div class="field">
        <label for="pair-hostname"
          >${host._localize("settings.pair_build_server_hostname_label")}</label
        >
        <input
          id="pair-hostname"
          type="text"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          ?disabled=${host._busy}
          placeholder=${host._localize("settings.pair_build_server_hostname_placeholder")}
          .value=${host._hostname}
          @input=${(e: Event) => {
            host._hostname = (e.target as HTMLInputElement).value;
            // Track receiver label off hostname until user edits it manually.
            // Saves a redundant type for the "name = host" case without
            // overwriting a deliberate edit.
            if (!host._receiverLabelTouched) {
              host._receiverLabel = friendlyHostname(host._hostname);
            }
            host._error = null;
          }}
        />
      </div>
      <div class="field field--port">
        <label for="pair-port"
          >${host._localize("settings.pair_build_server_port_label")}</label
        >
        <input
          id="pair-port"
          type="number"
          min="1"
          max="65535"
          ?disabled=${host._busy}
          .value=${host._port}
          @input=${(e: Event) => {
            host._port = (e.target as HTMLInputElement).value;
            host._error = null;
          }}
        />
      </div>
    </div>
    <div class="helper">${host._localize("settings.pair_build_server_port_helper")}</div>
    ${host._error
      ? html`<div class="step-error" role="alert">${host._error}</div>`
      : nothing}
    <div class="actions">
      <button class="btn btn--cancel" ?disabled=${host._busy} @click=${host.close}>
        ${host._localize("layout.cancel")}
      </button>
      <button
        class="btn btn--primary"
        ?disabled=${!canSubmit}
        @click=${host._onPreviewSubmit}
      >
        ${host._busy
          ? host._localize("settings.pair_build_server_previewing")
          : host._localize("settings.pair_build_server_preview_action")}
      </button>
    </div>
  `;
}

export function renderConfirmStep(host: ESPHomePairBuildServerDialog): TemplateResult {
  const canSubmit =
    !host._busy &&
    host._receiverLabel.trim().length > 0 &&
    host._offloaderLabel.trim().length > 0;
  return html`
    <div class="description">
      ${host._localize("settings.pair_build_server_confirm_desc")}
    </div>
    <div class="pin-card">
      <span class="pin-card-label">
        ${host._localize("settings.pair_build_server_pin_label")}
      </span>
      <esphome-pin-emoji-grid .pin=${host._previewedPin}></esphome-pin-emoji-grid>
      <details class="pin-hex">
        <summary>${host._localize("settings.pair_build_server_pin_hex_summary")}</summary>
        <code>${formatPinSha256(host._previewedPin)}</code>
      </details>
      <span class="pin-card-target">
        ${host._localize("settings.pair_build_server_target", {
          hostname: trimTrailingDot(host._hostname),
          port: host._port,
        })}
      </span>
    </div>
    <div class="trust-warning" role="alert">
      ${host._localize("settings.pair_build_server_trust_warning")}
    </div>
    <div class="field">
      <label for="pair-receiver-label">
        ${host._localize("settings.pair_build_server_receiver_label_label")}
      </label>
      <input
        id="pair-receiver-label"
        type="text"
        autocomplete="off"
        ?disabled=${host._busy}
        .value=${host._receiverLabel}
        placeholder=${host._localize(
          "settings.pair_build_server_receiver_label_placeholder"
        )}
        @input=${(e: Event) => {
          host._receiverLabel = (e.target as HTMLInputElement).value;
          host._receiverLabelTouched = true;
          host._error = null;
        }}
      />
      <span class="helper">
        ${host._localize("settings.pair_build_server_receiver_label_helper")}
      </span>
    </div>
    <div class="field">
      <label for="pair-offloader-label">
        ${host._localize("settings.pair_build_server_offloader_label_label")}
      </label>
      <input
        id="pair-offloader-label"
        type="text"
        autocomplete="off"
        ?disabled=${host._busy}
        .value=${host._offloaderLabel}
        placeholder=${host._localize(
          "settings.pair_build_server_offloader_label_placeholder"
        )}
        @input=${(e: Event) => {
          host._offloaderLabel = (e.target as HTMLInputElement).value;
          host._error = null;
        }}
      />
      <span class="helper">
        ${host._localize("settings.pair_build_server_offloader_label_helper")}
      </span>
    </div>
    ${host._error
      ? html`<div class="step-error" role="alert">${host._error}</div>`
      : nothing}
    <div class="actions">
      <button
        class="btn btn--cancel"
        ?disabled=${host._busy}
        @click=${host._onConfirmBack}
      >
        ${host._localize("layout.back")}
      </button>
      <button
        class="btn btn--primary"
        ?disabled=${!canSubmit}
        @click=${host._onConfirmSubmit}
      >
        ${host._busy
          ? host._localize("settings.pair_build_server_sending")
          : host._localize("settings.pair_build_server_request_action")}
      </button>
    </div>
  `;
}

export function renderSentStep(host: ESPHomePairBuildServerDialog): TemplateResult {
  return html`
    <div class="sent-body">
      ${host._localize("settings.pair_build_server_sent_desc", {
        hostname: host._hostname,
        port: host._port,
      })}
    </div>
    <div class="actions">
      <button class="btn btn--primary" @click=${host.close}>
        ${host._localize("layout.close")}
      </button>
    </div>
  `;
}
