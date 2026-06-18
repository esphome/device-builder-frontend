import { consume } from "@lit/context";
import { LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import {
  localizeContext,
  offloaderIncludeLocalInPoolContext,
} from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { renderToggleRow } from "./settings-rows.js";
import { settingsRowStyles, settingsSharedStyles } from "./shared-styles.js";

/**
 * "Include local in build pool" toggle for the Build offload section.
 *
 * Shown inline to every user (the setting is buried enough in the section
 * that gating it would hide it from everyone who'd use it). Its own
 * component so the parent section stays under the file-size cap; dispatches
 * a bubbling+composed ``set-offloader-include-local`` event app-shell handles.
 */
@customElement("esphome-settings-build-offload-advanced")
export class ESPHomeSettingsBuildOffloadAdvanced extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: offloaderIncludeLocalInPoolContext, subscribe: true })
  @state()
  private _includeLocalInPool: boolean | null = null;

  static styles = [espHomeStyles, settingsSharedStyles, settingsRowStyles];

  protected render() {
    return renderToggleRow(this._localize, {
      titleId: "offloader-include-local-title",
      titleKey: "settings.offloader_include_local",
      descKey: "settings.offloader_include_local_desc",
      loadingDescKey: "settings.offloader_include_local_loading",
      checked: this._includeLocalInPool,
      onToggle: this._onToggleIncludeLocal,
    });
  }

  private _onToggleIncludeLocal = () => {
    if (this._includeLocalInPool === null) return;
    this.dispatchEvent(
      new CustomEvent("set-offloader-include-local", {
        detail: !this._includeLocalInPool,
        bubbles: true,
        composed: true,
      })
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-settings-build-offload-advanced": ESPHomeSettingsBuildOffloadAdvanced;
  }
}
