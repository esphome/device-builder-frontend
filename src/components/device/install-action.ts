import { html, type TemplateResult } from "lit";
import type { LocalizeFunc } from "../../common/localize.js";
import { updateButtonTitle } from "../../util/update-tooltip.js";

export interface InstallActionProps {
  localize: LocalizeFunc;
  hasUpdateAvailable: boolean;
  hasPendingChanges: boolean;
  busy: boolean;
  // Installed + target ESPHome versions for the Update hover (see updateButtonTitle).
  installedVersion: string;
  availableVersion: string;
  onUpdate: () => void;
  onInstall: () => void;
}

/**
 * The editor footer's always-available install affordance. With an update
 * available the main button keeps the one-click OTA; the caret opens the
 * install-method picker (Web Serial / OTA / manual) so a re-flash or
 * replacement chip still has a path. Otherwise a plain Install opens the
 * picker — highlighted when there are pending changes, muted but still usable
 * when the config already matches the deployed firmware. Rendered into the
 * device-editor shadow root, so its `.install-fab` styles apply.
 */
export function renderInstallAction(p: InstallActionProps): TemplateResult {
  if (p.hasUpdateAvailable) {
    return html`<div class="install-split">
      <button
        type="button"
        class="install-fab install-split__main"
        ?disabled=${p.busy}
        @click=${p.onUpdate}
        title=${updateButtonTitle(
          p.localize,
          p.installedVersion,
          p.availableVersion,
          "dashboard.update"
        )}
      >
        <wa-icon library="mdi" name="upload"></wa-icon>
        ${p.localize("dashboard.update")}
      </button>
      <button
        type="button"
        class="install-fab install-split__caret"
        ?disabled=${p.busy}
        @click=${p.onInstall}
        aria-label=${p.localize("device.install_choose_method")}
        title=${p.localize("device.install_choose_method")}
      >
        <wa-icon library="mdi" name="chevron-down"></wa-icon>
      </button>
    </div>`;
  }
  return html`<button
    type="button"
    class="install-fab ${p.hasPendingChanges ? "" : "install-fab--muted"}"
    ?disabled=${p.busy}
    @click=${p.onInstall}
    title=${p.localize("dashboard.install")}
  >
    <wa-icon library="mdi" name="upload"></wa-icon>
    ${p.localize("dashboard.install")}
  </button>`;
}
