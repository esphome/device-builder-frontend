import {
  html,
  type ReactiveController,
  type ReactiveControllerHost,
  type TemplateResult,
} from "lit";

import type { LocalizeFunc } from "../../common/localize.js";

// ESPHome's own log lines around the nRF Connect SDK install
// (esphome/components/nrf52/framework.py) and the build that follows it.
const DOWNLOAD_START = /Initializing nRF Connect SDK|Resuming the nRF Connect SDK/;
const BUILD_START = /Compiling app/;

/**
 * Watches a compile's log for the first nRF52 build's SDK download: ESPHome
 * clones about 2 GB before it compiles, and the log can sit quiet for minutes
 * while it does, so people cancel it. ``active`` runs from the download's
 * first line until the build itself starts.
 */
export class SdkDownloadWatch implements ReactiveController {
  active = false;

  constructor(private readonly _host: ReactiveControllerHost) {
    _host.addController(this);
  }

  hostConnected(): void {}

  /** ``LogBuffer``'s ``onAppend``: a batch starting at stream position 0 is a new run. */
  observe(lines: readonly string[], start: number): void {
    let active = start === 0 ? false : this.active;
    for (const line of lines) {
      if (DOWNLOAD_START.test(line)) active = true;
      else if (BUILD_START.test(line)) active = false;
    }
    if (active === this.active) return;
    this.active = active;
    this._host.requestUpdate();
  }
}

/** The hint in the terminal's suggestion slot, with the other compile hints' markup. */
export function renderSdkDownloadHint(localize: LocalizeFunc): TemplateResult {
  return html`<div class="reset-suggestion" role="status" slot="suggestion">
    ${localize("command.sdk_download_hint")}
  </div>`;
}
