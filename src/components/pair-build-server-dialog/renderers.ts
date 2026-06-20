import { html, nothing, type TemplateResult } from "lit";
import {
  friendlyHostname,
  parsePortInput,
  trimTrailingDot,
} from "../../util/hostname.js";
import { formatPinSha256 } from "../../util/pin-format.js";
import type { ESPHomePairBuildServerDialog } from "../pair-build-server-dialog.js";

// Emoji icon row + collapsible hex bytes for a SHA-256 pin. Shared by the
// confirm step (the receiver's fingerprint) and the sent step (this
// dashboard's own fingerprint) so the two render identically.
function renderFingerprint(
  host: ESPHomePairBuildServerDialog,
  pin: string
): TemplateResult {
  return html`
    <esphome-pin-emoji-grid .pin=${pin}></esphome-pin-emoji-grid>
    <details class="pin-hex">
      <summary>${host._localize("settings.pair_build_server_pin_hex_summary")}</summary>
      <code>${formatPinSha256(pin)}</code>
    </details>
  `;
}

// Footer slot shared by the input + confirm steps: the step error (when set)
// stacked above the actions row, pinned outside the scrolling body.
function renderFooter(
  host: ESPHomePairBuildServerDialog,
  actions: TemplateResult
): TemplateResult {
  return html`
    <div slot="footer" class="dialog-footer">
      ${host._error
        ? html`<div class="step-error" role="alert">${host._error}</div>`
        : nothing}
      <div class="actions">${actions}</div>
    </div>
  `;
}

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
    ${renderFooter(
      host,
      html`
        <button class="btn btn--cancel" ?disabled=${host._sending} @click=${host.close}>
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
      `
    )}
  `;
}

export function renderConfirmStep(host: ESPHomePairBuildServerDialog): TemplateResult {
  // Busy with no pin yet = auto-preview still in flight (mDNS-discovered host
  // jumped straight here); show a connecting state until the fingerprint lands.
  // Gating on _busy means a degenerate empty pin from the backend renders the
  // landed branch rather than an unresolving spinner.
  const connecting = host._busy && host._previewedPin === "";
  const canSubmit =
    !host._busy &&
    host._previewedPin !== "" &&
    host._receiverLabel.trim().length > 0 &&
    host._offloaderLabel.trim().length > 0;
  return html`
    <div class="description">
      ${host._localize("settings.pair_build_server_confirm_desc")}
    </div>
    <!-- role="status" on the card (not the inner connecting div) makes one
         polite live region cover both states, so a screen reader hears
         "connecting…" and then the fingerprint when the auto-preview lands. -->
    <div class="pin-card" role="status">
      ${connecting
        ? html`
            <div class="pin-connecting">
              <wa-spinner></wa-spinner>
              <span>
                ${host._localize("settings.pair_build_server_connecting", {
                  hostname: trimTrailingDot(host._hostname),
                  port: host._port,
                })}
              </span>
            </div>
          `
        : html`
            <span class="pin-card-label">
              ${host._localize("settings.pair_build_server_pin_label")}
            </span>
            ${renderFingerprint(host, host._previewedPin)}
            <span class="pin-card-target">
              ${host._localize("settings.pair_build_server_target", {
                hostname: trimTrailingDot(host._hostname),
                port: host._port,
              })}
            </span>
          `}
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
    ${renderFooter(
      host,
      html`
        <button
          class="btn btn--cancel"
          ?disabled=${host._sending}
          @click=${host._onConfirmBack}
        >
          ${host._skippedInput
            ? host._localize("layout.cancel")
            : host._localize("layout.back")}
        </button>
        <button
          class="btn btn--primary"
          ?disabled=${!canSubmit}
          @click=${host._onConfirmSubmit}
        >
          ${host._busy && !connecting
            ? host._localize("settings.pair_build_server_sending")
            : host._localize("settings.pair_build_server_request_action")}
        </button>
      `
    )}
  `;
}

export function renderSentStep(host: ESPHomePairBuildServerDialog): TemplateResult {
  const identity = host._offloaderIdentity;
  return html`
    <div class="sent-body">
      ${host._localize("settings.pair_build_server_sent_desc", {
        hostname: host._hostname,
        port: host._port,
      })}
    </div>
    ${identity
      ? html`
          <div class="pin-card">
            <span class="pin-card-label">
              ${host._localize("settings.pair_build_server_sent_dashboard_id_label")}
            </span>
            <code>${identity.dashboard_id}</code>
            <span class="pin-card-label">
              ${host._localize("settings.pair_build_server_sent_pin_label")}
            </span>
            ${renderFingerprint(host, identity.pin_sha256)}
          </div>
        `
      : nothing}
    <div slot="footer" class="actions">
      <button class="btn btn--primary" @click=${host.close}>
        ${host._localize("layout.close")}
      </button>
    </div>
  `;
}
