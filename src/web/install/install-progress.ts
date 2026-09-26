import { css, html, nothing, type TemplateResult } from "lit";

import type { LocalizeFunc } from "../../common/localize.js";
import "../../components/process-terminal/process-terminal.js";
import "../../components/install-details-log.js";
import type { ProcessTerminalState } from "../../components/process-terminal/process-terminal.js";
import type { InstallFlowController } from "./install-flow-controller.js";

/** Map a flow step to the terminal card's status banner state. */
function terminalState(flow: InstallFlowController): ProcessTerminalState {
  if (flow.done) return "success";
  if (flow.errored) return "error";
  if (flow.busy) return "running";
  return null;
}

/** Localized one-line status for the current step. */
function statusMessage(flow: InstallFlowController, localize: LocalizeFunc): string {
  switch (flow.step) {
    case "connecting":
      return localize("firmware.status_connecting");
    case "preparing":
      return localize("web.install.preparing");
    case "erasing":
      return localize("web.install.erasing");
    case "flashing":
      return localize("dashboard.status_installing");
    case "done":
      return localize("web.install.done");
    case "error":
      return localize("firmware.status_failed");
    default:
      return "";
  }
}

/**
 * Render the flashing-phase progress card shared by the install dialogs: the
 * reused ``process-terminal`` in ``card`` variant, driven by the flow
 * controller's reactive state.
 */
export function renderInstallProgress(
  flow: InstallFlowController,
  localize: LocalizeFunc
): TemplateResult {
  return renderProgressCard(
    {
      state: terminalState(flow),
      message: statusMessage(flow, localize),
      detail: flow.errored ? flow.errorMessage : "",
      progress: flow.step === "flashing" ? flow.progress : null,
      log: flow.logLines,
    },
    localize
  );
}

export interface ProgressCard {
  state: ProcessTerminalState;
  message: string;
  detail?: string;
  progress?: number | null;
  /** The flash engine's step lines, in a details log that opens on failure. */
  log?: readonly string[];
}

/**
 * The progress card itself, for the dialogs that drive their own steps.
 * While a write shows its progress bar the detail asks the user to keep the
 * window visible: hidden tabs throttle timers, which can stall the Web Serial
 * write and fail the flash, and there is no API to opt out.
 */
export function renderProgressCard(
  card: ProgressCard,
  localize: LocalizeFunc
): TemplateResult {
  const writing = card.progress !== undefined && card.progress !== null;
  return html`
    <esphome-process-terminal
      variant="card"
      .state=${card.state}
      .statusMessage=${card.message}
      .statusDetail=${card.detail || (writing ? localize("firmware.flashing_keep_visible") : "")}
      .progress=${card.progress ?? null}
    >
      ${
        card.log?.length
          ? html`<esphome-install-details-log
              slot="status-extra"
              download-name="esphome-web-install.txt"
              .lines=${card.log}
              .expanded=${card.state === "error"}
            ></esphome-install-details-log>`
          : nothing
      }
    </esphome-process-terminal>
  `;
}

/** The card's banner state for a self-driven dialog's step: a wait step shows no banner. */
export function installTerminalState(step: string): ProcessTerminalState {
  switch (step) {
    case "success":
      return "success";
    case "error":
      return "error";
    case "waiting":
      return null;
    default:
      return "running";
  }
}

export function renderRetryButton(
  localize: LocalizeFunc,
  onClick: () => void
): TemplateResult {
  return html`
    <wa-button variant="neutral" @click=${onClick}
      >${localize("command.retry")}</wa-button
    >
  `;
}

export function renderCloseButton(
  localize: LocalizeFunc,
  onClick: () => void
): TemplateResult {
  return html`
    <wa-button variant="brand" @click=${onClick}>${localize("command.close")}</wa-button>
  `;
}

/** The right-aligned action row under a dialog's body. */
export const installActionsStyles = css`
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--wa-space-m);
  }
`;
