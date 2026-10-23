import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, localizeContext } from "../context/index.js";
import { navigate, PopLeaveGuardController } from "../util/navigation.js";
import { notifyError, notifySuccess } from "../util/notify.js";
import { SaveShortcutController } from "../util/save-shortcut-controller.js";
import "../components/yaml-editor.js";

@customElement("esphome-page-package")
export class ESPHomePagePackage extends LitElement {
  @consume({ context: apiContext }) private _api!: ESPHomeAPI;
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;
  @property() path = "";
  @state() private _yaml = "";
  @state() private _saved = "";
  @state() private _devices: string[] = [];
  @state() private _loading = true;
  @state() private _saving = false;
  @state() private _results: {
    configuration: string;
    valid: boolean;
    errors: unknown[];
  }[] = [];
  private _loadToken = 0;
  protected readonly _saveShortcut = new SaveShortcutController(this, () => {
    if (this._yaml !== this._saved) void this._save();
  });
  protected readonly _leaveGuard = new PopLeaveGuardController(this, {
    isDirty: () => this._yaml !== this._saved,
    confirmLeave: async () => window.confirm("Discard unsaved package changes?"),
    url: () => `/package/${encodeURIComponent(this.path)}`,
  });

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("beforeunload", this._beforeUnload);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("beforeunload", this._beforeUnload);
  }
  protected updated(changed: Map<string, unknown>) {
    if (changed.has("path") && this.path) void this._load();
  }
  private _beforeUnload = (event: BeforeUnloadEvent) => {
    if (this._yaml !== this._saved) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  private async _load() {
    const token = ++this._loadToken;
    this._loading = true;
    try {
      const [yaml, devices] = await Promise.all([
        this._api.getPackage(this.path),
        this._api.listPackageDevices(this.path),
      ]);
      if (token !== this._loadToken) return;
      this._yaml = this._saved = yaml;
      this._devices = devices;
    } catch (error) {
      notifyError(error instanceof Error ? error.message : String(error));
    } finally {
      if (token === this._loadToken) this._loading = false;
    }
  }
  private _onYamlChange(event: CustomEvent<{ value: string }>) {
    this._yaml = event.detail.value;
  }
  private async _save() {
    if (this._saving || this._yaml === this._saved) return;
    this._saving = true;
    try {
      const response = await this._api.savePackage(this.path, this._yaml);
      this._saved = this._yaml;
      this._results = response.results;
      this._devices = response.results.map((row) => row.configuration);
      notifySuccess(this._localize("device.yaml_saved"));
    } catch (error) {
      notifyError(error instanceof Error ? error.message : String(error));
    } finally {
      this._saving = false;
    }
  }
  private async _back() {
    const from = new URLSearchParams(window.location.search).get("from");
    if (from) await navigate(`/device/${encodeURIComponent(from)}`);
    else if (history.length > 1) history.back();
    else await navigate("/");
  }
  protected render() {
    const title = this.path.replace(/^packages\//, "");
    return html`<main class="package-page">
      <header>
        <button @click=${this._back}>← Device YAML</button
        ><span>Packages / ${title}</span>
        <button
          ?disabled=${this._saving || this._yaml === this._saved}
          @click=${this._save}
        >
          ${this._saving ? "Saving…" : "Save YAML"}
        </button>
      </header>
      <div class="layout">
        <aside>
          <h2>Devices using this package</h2>
          ${
            this._devices.length
              ? this._devices.map(
                  (device) =>
                    html`<button
                      class="device"
                      @click=${async () => {
                        await navigate(
                          `/device/${encodeURIComponent(device)}?returnPackage=${encodeURIComponent(this.path)}`
                        );
                      }}
                    >
                      ${device}
                    </button>`
                )
              : html`<p>No saved devices reference this package.</p>`
          }
        </aside>
        <section>
          ${this._loading ? html`<p>Loading…</p>` : html`<esphome-yaml-editor .value=${this._yaml} .configuration=${this.path} @yaml-change=${this._onYamlChange}></esphome-yaml-editor>`}
          ${
            this._results.length
              ? html`<section class="results">
                  <h2>Dependent device validation</h2>
                  ${this._results.map((row) => html`<p class=${row.valid ? "valid" : "invalid"}>${row.valid ? "✓" : "✗"} ${row.configuration}${row.errors.length ? html`<pre>${JSON.stringify(row.errors, null, 2)}</pre>` : nothing}</p>`)}
                </section>`
              : nothing
          }
        </section>
      </div>
    </main>`;
  }
  static styles = css`
    :host {
      display: block;
      height: 100%;
    }
    .package-page {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    header {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--divider-color, #ddd);
    }
    header span {
      flex: 1;
      font-weight: 600;
    }
    button {
      cursor: pointer;
      padding: 0.45rem 0.75rem;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
      flex: 1;
      min-height: 0;
    }
    aside {
      padding: 1rem;
      overflow: auto;
      border-right: 1px solid var(--divider-color, #ddd);
    }
    aside h2,
    .results h2 {
      font-size: 1rem;
    }
    .device {
      display: block;
      width: 100%;
      text-align: left;
      margin: 0.3rem 0;
    }
    section {
      min-height: 0;
      overflow: auto;
    }
    esphome-yaml-editor {
      display: block;
      height: 100%;
      min-height: 320px;
    }
    .results {
      padding: 0.5rem 1rem;
      max-height: 35vh;
      overflow: auto;
      border-top: 1px solid var(--divider-color, #ddd);
    }
    .valid {
      color: var(--success-color, #278142);
    }
    .invalid {
      color: var(--error-color, #b3261e);
    }
    pre {
      white-space: pre-wrap;
    }
    @media (max-width: 700px) {
      .layout {
        grid-template-columns: 1fr;
        grid-template-rows: auto minmax(0, 1fr);
      }
      aside {
        border-right: 0;
        border-bottom: 1px solid var(--divider-color, #ddd);
        max-height: 170px;
      }
    }
  `;
}
declare global {
  interface HTMLElementTagNameMap {
    "esphome-page-package": ESPHomePagePackage;
  }
}
