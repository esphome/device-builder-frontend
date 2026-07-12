import { html, type TemplateResult } from "lit";
import type { LocalizeFunc } from "../../common/localize.js";
import { busyActionLabel, updateActionTitle } from "../../util/update-tooltip.js";

export interface InstallActionProps {
  localize: LocalizeFunc;
  showUpdate: boolean;
  showModified: boolean;
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
 * when the config already matches the deployed firmware. While a job runs
 * (`busy`) the main buttons stay clickable — the page routes the click to the
 * running job's progress dialog — and only the caret disables, since picking
 * a method for a *new* job is exactly what can't start mid-job. Rendered into
 * the device-editor shadow root, so its `.install-fab` styles apply.
 */
export function renderInstallAction(p: InstallActionProps): TemplateResult {
  // The visible text is the accessible name (no aria-label), and it flips to
  // view-progress while busy — one honest label for sighted, screen-reader,
  // and voice-control users alike (WCAG 2.5.3 Label in Name).
  if (p.showUpdate) {
    return html`<div class="install-split">
      <button
        type="button"
        class="install-fab install-split__main"
        @click=${p.onUpdate}
        title=${updateActionTitle(
          p.localize,
          p.busy,
          p.installedVersion,
          p.availableVersion,
          "dashboard.update"
        )}
      >
        <wa-icon library="mdi" name="upload"></wa-icon>
        ${busyActionLabel(p.localize, p.busy, "dashboard.update")}
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
  const installLabel = busyActionLabel(p.localize, p.busy, "dashboard.install");
  return html`<button
    type="button"
    class="install-fab ${p.showModified ? "" : "install-fab--muted"}"
    @click=${p.onInstall}
    title=${installLabel}
  >
    <wa-icon library="mdi" name="upload"></wa-icon>
    ${installLabel}
  </button>`;
}
