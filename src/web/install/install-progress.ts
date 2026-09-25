import { html, nothing, type TemplateResult } from "lit";

import type { LocalizeFunc } from "../../common/localize.js";
import "../../components/process-terminal/process-terminal.js";
import "./esphome-web-install-log.js";
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
  return renderProgressCard({
    state: terminalState(flow),
    message: statusMessage(flow, localize),
    detail: flow.errored ? flow.errorMessage : "",
    progress: flow.step === "flashing" ? flow.progress : null,
    log: flow.logLines,
  });
}

export interface ProgressCard {
  state: ProcessTerminalState;
  message: string;
  detail?: string;
  progress?: number | null;
  /** The flash engine's step lines, shown in a collapsible details log. */
  log?: readonly string[];
}

/** The progress card itself, for the dialogs that drive their own steps. */
export function renderProgressCard(card: ProgressCard): TemplateResult {
  return html`
    <esphome-process-terminal
      variant="card"
      .state=${card.state}
      .statusMessage=${card.message}
      .statusDetail=${card.detail ?? ""}
      .progress=${card.progress ?? null}
    >
      ${
        card.log?.length
          ? html`<esphome-web-install-log
              slot="status-extra"
              .lines=${card.log}
            ></esphome-web-install-log>`
          : nothing
      }
    </esphome-process-terminal>
  `;
}
