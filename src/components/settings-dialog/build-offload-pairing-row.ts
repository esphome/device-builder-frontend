import { html, nothing, type TemplateResult } from "lit";

import type { PairingSummary } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import type { RemoteBuildJobState } from "../../context/index.js";
import { trimTrailingDot } from "../../util/hostname.js";
import { classifyVersionMismatch } from "../../util/version-mismatch.js";

interface PillResult {
  pillClass: string;
  pillLabel: string;
}

export function pillFor(pairing: PairingSummary, localize: LocalizeFunc): PillResult {
  if (pairing.status !== "approved") {
    return {
      pillClass: "pairing-status-pill pairing-status-pending",
      pillLabel: localize("settings.pairing_status_pending"),
    };
  }
  if (pairing.connected) {
    return {
      pillClass: "peer-connection-pill peer-connection-connected",
      pillLabel: localize("settings.build_offload_pairing_connected"),
    };
  }
  if (pairing.connecting) {
    return {
      pillClass: "peer-connection-pill peer-connection-connecting",
      pillLabel: localize("settings.build_offload_pairing_connecting"),
    };
  }
  return {
    pillClass: "peer-connection-pill peer-connection-disconnected",
    pillLabel: localize("settings.build_offload_pairing_disconnected"),
  };
}

interface PairingRowContext {
  localize: LocalizeFunc;
  appVersion: string;
  latestJob: RemoteBuildJobState | undefined;
  onToggleEnabled: (pairing: PairingSummary) => void;
  onBuildRemote: (pairing: PairingSummary) => void;
  onViewBuild: (jobId: string) => void;
  onEditEndpoint: (pairing: PairingSummary) => void;
  onUnpair: (pairing: PairingSummary) => void;
}

export function renderPairingRow(
  pairing: PairingSummary,
  ctx: PairingRowContext
): TemplateResult {
  const {
    localize,
    appVersion,
    latestJob,
    onToggleEnabled,
    onBuildRemote,
    onViewBuild,
    onEditEndpoint,
    onUnpair,
  } = ctx;
  const { pillClass, pillLabel } = pillFor(pairing, localize);
  return html`
    <div class="row peer-row pairing-row">
      <div class="row-label">
        <span class="row-title">
          ${pairing.label}
          <span class=${pillClass}>${pillLabel}</span>
        </span>
        <span class="row-desc">
          ${trimTrailingDot(pairing.receiver_hostname)}:${pairing.receiver_port}
        </span>
        ${pairing.status === "approved" &&
        !pairing.connected &&
        pairing.last_connect_error
          ? html`
              <span class="row-desc pairing-last-error" role="status">
                ${localize("settings.build_offload_pairing_last_error", {
                  detail: pairing.last_connect_error,
                })}
              </span>
            `
          : nothing}
        ${renderVersionMismatch(pairing, localize, appVersion)}
      </div>
      ${pairing.status === "approved"
        ? html`
            <button
              class="toggle"
              role="switch"
              aria-label=${localize("settings.build_offload_pairing_enabled_aria", {
                label: pairing.label,
              })}
              aria-checked=${pairing.enabled}
              title=${localize("settings.build_offload_pairing_enabled_title")}
              @click=${() => onToggleEnabled(pairing)}
            ></button>
          `
        : nothing}
      ${pairing.status === "approved" && pairing.connected
        ? html`
            <button
              type="button"
              class="btn-build-remote"
              aria-label=${localize("settings.remote_build_submit_aria", {
                label: pairing.label,
              })}
              @click=${() => onBuildRemote(pairing)}
            >
              ${localize("settings.remote_build_submit_action")}
            </button>
          `
        : nothing}
      ${latestJob !== undefined
        ? html`
            <button
              type="button"
              class="btn-view-remote-build"
              aria-label=${localize("settings.remote_build_view_aria", {
                label: pairing.label,
              })}
              @click=${() => onViewBuild(latestJob.job_id)}
            >
              ${localize("settings.remote_build_view_action")}
            </button>
          `
        : nothing}
      ${pairing.status === "approved"
        ? html`
            <button
              type="button"
              class="btn-edit-endpoint"
              aria-label=${localize("settings.edit_pairing_endpoint_aria", {
                label: pairing.label,
              })}
              title=${localize("settings.edit_pairing_endpoint_aria", {
                label: pairing.label,
              })}
              @click=${() => onEditEndpoint(pairing)}
            >
              <wa-icon library="mdi" name="pencil"></wa-icon>
            </button>
          `
        : nothing}
      <button
        type="button"
        class="peer-remove btn-unpair"
        aria-label=${localize("settings.unpair_aria", { label: pairing.label })}
        @click=${() => onUnpair(pairing)}
      >
        ${localize("settings.unpair_action")}
      </button>
    </div>
  `;
}

function renderVersionMismatch(
  pairing: PairingSummary,
  localize: LocalizeFunc,
  appVersion: string
): TemplateResult | typeof nothing {
  if (pairing.status !== "approved") return nothing;
  const kind = classifyVersionMismatch(appVersion, pairing.esphome_version);
  if (kind === null) return nothing;
  const key =
    kind === "release"
      ? "settings.build_offload_pairing_version_mismatch_release"
      : "settings.build_offload_pairing_version_mismatch_patch";
  return html`
    <span
      class=${`row-desc pairing-version-mismatch pairing-version-mismatch--${kind}`}
      role="status"
    >
      ${localize(key, { peer: pairing.esphome_version, local: appVersion })}
    </span>
  `;
}

export function latestJobForPin(
  jobs: Map<string, RemoteBuildJobState> | null,
  pin_sha256: string
): RemoteBuildJobState | undefined {
  if (jobs === null) return undefined;
  let best: RemoteBuildJobState | undefined;
  for (const job of jobs.values()) {
    if (job.pin_sha256 !== pin_sha256) continue;
    if (best === undefined || job.started_at > best.started_at) {
      best = job;
    }
  }
  return best;
}
