import { html, nothing, type TemplateResult } from "lit";
import { pairingAddress } from "../../util/pairing-address.js";
import { formatPinSha256 } from "../../util/pin-format.js";
import type { ESPHomeRemoteBuildPanel } from "../remote-build-panel.js";
import { renderPairingAddress } from "../shared/pairing-address.js";
import { renderPairingWindowStatus } from "../shared/pairing-window-status.js";

/** Nothing paired yet: walk the operator through the receiver pairing flow. */
export function renderOnboarding(host: ESPHomeRemoteBuildPanel): TemplateResult {
  const windowOpen = host._windowState?.open === true;
  const address = pairingAddress(host._identity.identity);
  return html`
    <div class="intro">${host._localize("remote_build_dashboard.intro_empty")}</div>
    <div class="steps">
      <div class="step">
        <div class="step-label">
          ${host._localize("remote_build_dashboard.step_open_window_label")}
        </div>
        <div class="step-title">
          ${host._localize("remote_build_dashboard.step_open_window_title")}
        </div>
        <div class="step-desc">
          ${host._localize("remote_build_dashboard.step_open_window_desc")}
        </div>
        <div class="step-action">
          ${
            windowOpen
              ? renderPairingWindowStatus(
                  host._localize,
                  host._windowState,
                  host._window.remainingSeconds(),
                  host._extendWindow
                )
              : html`
                  <button
                    type="button"
                    class="primary-action"
                    title=${host._localize(
                      "remote_build_dashboard.open_pairing_window_tooltip"
                    )}
                    @click=${host._openWindow}
                  >
                    ${host._localize("remote_build_dashboard.open_pairing_window")}
                  </button>
                `
          }
        </div>
      </div>
      <div class="step">
        <div class="step-label">
          ${host._localize("remote_build_dashboard.step_send_request_label")}
        </div>
        <div class="step-title">
          ${host._localize("remote_build_dashboard.step_send_request_title")}
        </div>
        <div class="step-desc">
          ${host._localize("remote_build_dashboard.step_send_request_desc")}
        </div>
        ${
          address
            ? html`
                <div class="step-action step-address">
                  ${host._localize("remote_build_dashboard.step_send_request_address")}
                  ${renderPairingAddress(host._localize, host._identity.identity)}
                </div>
              `
            : nothing
        }
      </div>
      <div class="step">
        <div class="step-label">
          ${host._localize("remote_build_dashboard.step_accept_request_label")}
        </div>
        <div class="step-title">
          ${host._localize("remote_build_dashboard.step_accept_request_title")}
        </div>
        <div class="step-desc">
          ${host._localize("remote_build_dashboard.step_accept_request_desc")}
        </div>
      </div>
    </div>
    ${renderFingerprintRow(host)}
  `;
}

/** remote_compute_only is on but the receiver listener toggle is off. */
export function renderDisabledCta(host: ESPHomeRemoteBuildPanel): TemplateResult {
  return html`
    <div class="disabled-cta">
      <div class="step-title">
        ${host._localize("remote_build_dashboard.disabled_title")}
      </div>
      <div class="step-desc">
        ${host._localize("remote_build_dashboard.disabled_desc")}
      </div>
      <div class="step-action">
        <button
          type="button"
          class="primary-action"
          @click=${host._openBuildServerSettings}
        >
          ${host._localize("remote_build_dashboard.disabled_cta")}
        </button>
      </div>
    </div>
  `;
}

function renderFingerprintRow(
  host: ESPHomeRemoteBuildPanel
): TemplateResult | typeof nothing {
  if (host._identity.loadFailed) {
    return html`
      <div class="status-row" role="alert">
        ${host._localize("settings.remote_build_identity_load_failed")}
      </div>
    `;
  }
  const identity = host._identity.identity;
  if (identity === null) {
    return html`
      <div class="status-row" role="status">
        ${host._localize("settings.remote_build_identity_loading")}
      </div>
    `;
  }
  return html`
    <div class="fingerprint-row">
      <span class="fingerprint-label">
        ${host._localize("settings.remote_build_pin_label")}
      </span>
      <div class="fingerprint-display">
        <esphome-pin-emoji-grid .pin=${identity.pin_sha256}></esphome-pin-emoji-grid>
        <details class="pin-hex">
          <summary>${host._localize("settings.remote_build_pin_hex_summary")}</summary>
          <code>${formatPinSha256(identity.pin_sha256)}</code>
        </details>
      </div>
    </div>
  `;
}
