import { html, type TemplateResult } from "lit";

import type { LocalizeFunc } from "../../common/localize.js";
import "../../components/process-terminal/process-terminal.js";
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
  return html`
    <esphome-process-terminal
      variant="card"
      .state=${terminalState(flow)}
      .statusMessage=${statusMessage(flow, localize)}
      .statusDetail=${flow.errored ? flow.errorMessage : ""}
      .progress=${flow.step === "flashing" ? flow.progress : null}
    ></esphome-process-terminal>
  `;
}
