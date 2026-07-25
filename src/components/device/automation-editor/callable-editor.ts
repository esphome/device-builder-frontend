/**
 * Intermediate base for the two trigger-less (callable) editors —
 * script and api-action. Owns the mount-time catalog load and the
 * shared hydrate the automation editor diverges from.
 */
import type { AutomationLocation } from "../../../api/types/automations.js";
import { getErrorMessage } from "../../../util/error-message.js";
import { formatApiError } from "../../../util/format-api-error.js";
import { BaseAutomationEditor } from "./base-editor.js";

export abstract class CallableAutomationEditor<
  L extends AutomationLocation,
> extends BaseAutomationEditor<L> {
  /** Section kind forwarded to the parse-error resolve. */
  protected abstract readonly _sectionKind: L["kind"];

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

  protected async _hydrateFromBackend() {
    if (!this._api || !this.configuration || !this.location) return;
    try {
      // ``this.yaml`` override mirrors the automation-editor's
      // hydrate path: post-add the user's draft buffer holds the
      // new section, but the on-disk YAML doesn't yet. Without the
      // override the parse returns the stale on-disk state and the
      // form lands empty.
      const parsed = await this._api.parseDeviceAutomations(
        this.configuration,
        this.yaml
      );
      const m = this._parseError.resolve(parsed, this.location, this._sectionKind);
      if (m) {
        this.location = m.location;
        this.value = m.tree;
      }
    } catch (err) {
      this._error = formatApiError(err, this._localize, "device.automation_parse_error");
    }
  }
}
