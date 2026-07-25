/**
 * Intermediate base for the two trigger-less (callable) editors —
 * script and api-action. Owns the mount-time catalog load the
 * automation editor diverges from.
 */
import type { AutomationLocation } from "../../../api/types/automations.js";
import { getErrorMessage } from "../../../util/error-message.js";
import { BaseAutomationEditor } from "./base-editor.js";

export abstract class CallableAutomationEditor<
  L extends AutomationLocation,
> extends BaseAutomationEditor<L> {
  connectedCallback(): void {
    super.connectedCallback();
    void this._load();
  }

  protected async _load() {
    if (!this._api) return;
    this._loading = true;
    this._error = "";
    try {
      if (this.configuration) await this._loadAvailable();
    } catch (err) {
      this._error = getErrorMessage(err);
    } finally {
      this._loading = false;
    }
  }

  protected async _loadAvailable() {
    // Hydrates config_entries (the slim catalog omits them); without
    // it every action renders fieldless since the node bails on an
    // empty config_entries list.
    this._error = "";
    const { available, error } = await this._catalogLoad.load(
      this._api,
      this.configuration,
      this._localize
    );
    if (error !== undefined) this._error = error;
    if (available) this._available = available;
  }
}
