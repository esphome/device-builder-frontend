import { consume } from "@lit/context";
import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import { apiContext } from "../../context/index.js";
import { fireEvent } from "../../util/fire-event.js";

@customElement("esphome-add-package-dialog")
export class ESPHomeAddPackageDialog extends LitElement {
  @consume({ context: apiContext }) private _api!: ESPHomeAPI;
  @property() configuration = "";
  @state() private _mode: "existing" | "new" = "existing";
  @state() private _path = "";
  @state() private _packages: string[] = [];
  @query("dialog") private _dialog!: HTMLDialogElement;

  open() {
    this._mode = "existing";
    this._path = "";
    this._dialog.showModal();
    void this._api
      .listPackages()
      .then((packages) => (this._packages = packages))
      .catch(() => (this._packages = []));
  }
  private _submit(event: Event) {
    event.preventDefault();
    const entered = this._path.trim();
    if (!entered) return;
    const path = entered.startsWith("packages/") ? entered : `packages/${entered}`;
    fireEvent(this, "package-selected", {
      configuration: this.configuration,
      path,
      create: this._mode === "new",
    });
    this._dialog.close();
  }
  protected render() {
    return html`<dialog>
      <form @submit=${this._submit}>
        <h2>Add package</h2>
        <label
          >Package
          <select
            .value=${this._mode}
            @change=${(e: Event) => {
              this._mode = (e.target as HTMLSelectElement).value as "existing" | "new";
              this._path = this._mode === "new" ? "packages/package.yaml" : "";
            }}
          >
            <option value="existing">Add an existing package</option>
            <option value="new">Create a new package</option>
          </select>
        </label>
        <label
          >Path
          ${
            this._mode === "existing" && this._packages.length
              ? html`<select
                  .value=${this._path}
                  @change=${(e: Event) => (this._path = (e.target as HTMLSelectElement).value)}
                >
                  <option value="">Choose a package…</option>
                  ${this._packages.map((path) => html`<option value=${path}>${path}</option>`)}
                </select>`
              : ""
          }
          <input
            required
            .value=${this._path}
            placeholder=${this._mode === "new" ? "packages/package.yaml" : "packages/common.yaml"}
            @input=${(e: Event) => (this._path = (e.target as HTMLInputElement).value)}
          />
        </label>
        <footer>
          <button type="button" @click=${() => this._dialog.close()}>Cancel</button
          ><button type="submit">
            ${this._mode === "new" ? "Create and edit" : "Add package"}
          </button>
        </footer>
      </form>
    </dialog>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "esphome-add-package-dialog": ESPHomeAddPackageDialog;
  }
}
