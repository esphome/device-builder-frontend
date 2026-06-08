import { consume } from "@lit/context";
import { mdiClose, mdiMagnify } from "@mdi/js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { navigatorSearchStyles } from "./device-navigator-search.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  magnify: mdiMagnify,
  close: mdiClose,
});

/** Navigator search box; emits ``navigator-search`` ``{ value }`` on edit/clear. */
@customElement("esphome-navigator-search")
export class ESPHomeNavigatorSearch extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property()
  value = "";

  /** Result summary shown while a query is active (e.g. "3 of 41"). */
  @property()
  resultLabel = "";

  @query("input")
  private _input!: HTMLInputElement;

  static styles = [espHomeStyles, navigatorSearchStyles];

  render() {
    const placeholder = this._localize("device.navigator_search_placeholder");
    return html`
      <div class="search">
        <wa-icon class="search-icon" library="mdi" name="magnify"></wa-icon>
        <input
          type="search"
          .value=${this.value}
          placeholder=${placeholder}
          aria-label=${placeholder}
          enterkeyhint="search"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          @input=${this._onInput}
          @keydown=${this._onKeydown}
        />
        ${this.value
          ? html`<button
              type="button"
              class="search-clear"
              @click=${this._clear}
              title=${this._localize("device.navigator_search_clear")}
              aria-label=${this._localize("device.navigator_search_clear")}
            >
              <wa-icon library="mdi" name="close"></wa-icon>
            </button>`
          : nothing}
      </div>
      ${this.value && this.resultLabel
        ? html`<p class="search-result" role="status">${this.resultLabel}</p>`
        : nothing}
    `;
  }

  private _onInput = (e: Event) => {
    this._emit((e.target as HTMLInputElement).value);
  };

  private _onKeydown = (e: KeyboardEvent) => {
    // Escape clears in-place; stop it from bubbling to a parent dialog/drawer.
    if (e.key === "Escape" && this.value) {
      e.stopPropagation();
      this._clear();
    }
  };

  private _clear = () => {
    this._emit("");
    this._input?.focus();
  };

  private _emit(value: string) {
    this.dispatchEvent(
      new CustomEvent("navigator-search", {
        detail: { value },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-navigator-search": ESPHomeNavigatorSearch;
  }
}
