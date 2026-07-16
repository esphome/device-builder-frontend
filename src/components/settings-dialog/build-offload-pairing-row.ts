import { html, nothing, type TemplateResult } from "lit";

import type { PairingSummary } from "../../api/types/remote-build.js";
import type { LocalizeFunc } from "../../common/localize.js";
import type { RemoteBuildJobState } from "../../context/index.js";
import { trimTrailingDot } from "../../util/hostname.js";
import { pairingDisplayName } from "../../util/pairing-display-name.js";
import { canResetBuildEnv } from "../remote-build-hint.js";
import {
  classifyVersionMismatch,
  isPinnableVersion,
} from "../../util/version-mismatch.js";

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
  onResetBuildEnv: (pairing: PairingSummary) => void;
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
    onResetBuildEnv,
    onUnpair,
  } = ctx;
  const { pillClass, pillLabel } = pillFor(pairing, localize);
  const displayName = pairingDisplayName(pairing);
  return html`
    <div class="row peer-row row--stacked">
      <div class="row-label">
        <span class="row-title">
          ${displayName}
          <span class=${pillClass}>${pillLabel}</span>
          ${
            pairing.status === "approved"
              ? html`
                  <button
                    class="toggle pairing-toggle"
                    role="switch"
                    aria-label=${localize("settings.build_offload_pairing_enabled_aria", {
                      label: displayName,
                    })}
                    aria-checked=${pairing.enabled}
                    title=${localize("settings.build_offload_pairing_enabled_title")}
                    @click=${() => onToggleEnabled(pairing)}
                  ></button>
                `
              : nothing
          }
        </span>
        <span class="row-desc">
          ${trimTrailingDot(pairing.receiver_hostname)}:${pairing.receiver_port}
        </span>
        ${
          pairing.status === "approved" &&
          !pairing.connected &&
          pairing.last_connect_error
            ? html`
                <span class="row-desc pairing-last-error" role="status">
                  ${localize("settings.build_offload_pairing_last_error", {
                    detail: pairing.last_connect_error,
                  })}
                </span>
              `
            : nothing
        }
        ${renderPeerVersion(pairing, localize, appVersion)}
      </div>
      <div class="pairing-actions">
        ${
          pairing.status === "approved" && pairing.connected
            ? html`
                <button
                  type="button"
                  class="btn-build-remote"
                  aria-label=${localize("settings.remote_build_submit_aria", {
                    label: displayName,
                  })}
                  @click=${() => onBuildRemote(pairing)}
                >
                  ${localize("settings.remote_build_submit_action")}
                </button>
              `
            : nothing
        }
        ${
          latestJob !== undefined
            ? html`
                <button
                  type="button"
                  class="btn-view-remote-build"
                  aria-label=${localize("settings.remote_build_view_aria", {
                    label: displayName,
                  })}
                  @click=${() => onViewBuild(latestJob.job_id)}
                >
                  ${localize("settings.remote_build_view_action")}
                </button>
              `
            : nothing
        }
        ${
          canResetBuildEnv(pairing)
            ? html`
                <button
                  type="button"
                  id="btn-reset-${pairing.pin_sha256}"
                  class="btn-reset-peer-env"
                  aria-label=${localize("settings.reset_peer_env_aria", {
                    label: displayName,
                  })}
                  @click=${() => onResetBuildEnv(pairing)}
                >
                  <wa-icon library="mdi" name="broom"></wa-icon>
                </button>
                <wa-tooltip for="btn-reset-${pairing.pin_sha256}">
                  ${localize("settings.reset_peer_env_aria", { label: displayName })}
                </wa-tooltip>
              `
            : nothing
        }
        ${
          pairing.status === "approved"
            ? html`
                <button
                  type="button"
                  id="btn-edit-${pairing.pin_sha256}"
                  class="btn-edit-endpoint"
                  aria-label=${localize("settings.edit_pairing_endpoint_aria", {
                    label: displayName,
                  })}
                  @click=${() => onEditEndpoint(pairing)}
                >
                  <wa-icon library="mdi" name="pencil"></wa-icon>
                </button>
                <wa-tooltip for="btn-edit-${pairing.pin_sha256}">
                  ${localize("settings.edit_pairing_endpoint_aria", {
                    label: displayName,
                  })}
                </wa-tooltip>
              `
            : nothing
        }
        <button
          type="button"
          id="btn-unpair-${pairing.pin_sha256}"
          class="peer-remove"
          aria-label=${localize("settings.unpair_aria", { label: displayName })}
          @click=${() => onUnpair(pairing)}
        >
          <wa-icon library="mdi" name="delete"></wa-icon>
        </button>
        <wa-tooltip for="btn-unpair-${pairing.pin_sha256}">
          ${localize("settings.unpair_aria", { label: displayName })}
        </wa-tooltip>
      </div>
    </div>
  `;
}

function renderPeerVersion(
  pairing: PairingSummary,
  localize: LocalizeFunc,
  appVersion: string
): TemplateResult | typeof nothing {
  // One sub-line for an approved row's version: a plain "ESPHome X"
  // when it matches the local version, or the cautionary note when it
  // doesn't. Hidden until the first handshake fills in esphome_version.
  if (pairing.status !== "approved" || !pairing.esphome_version) return nothing;
  const kind = classifyVersionMismatch(appVersion, pairing.esphome_version);
  // A mismatch the receiver can auto-provision isn't a caution: builds
  // run with this dashboard's own version in a venv on the server.
  if (
    kind !== null &&
    pairing.auto_provision_supported &&
    isPinnableVersion(appVersion)
  ) {
    return html`
      <span class="row-desc">
        ${localize("settings.build_offload_pairing_version_auto_provision", {
          peer: pairing.esphome_version,
          local: appVersion,
        })}
      </span>
    `;
  }
  if (kind === null) {
    return html`
      <span class="row-desc">
        ${localize("settings.remote_build_peer_version_line", {
          esphome: pairing.esphome_version,
        })}
      </span>
    `;
  }
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
