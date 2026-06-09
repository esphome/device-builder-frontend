import { consume } from "@lit/context";
import { mdiClose } from "@mdi/js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { navigatorSearchStyles } from "./device-navigator-search.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
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

  /** Focus the input; called by the navigator when it expands the box. */
  focusInput() {
    this._input?.focus();
  }

  render() {
    const placeholder = this._localize("device.navigator_search_placeholder");
    return html`
      <div class="search">
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
    // Track our own value so it never lags the parent's echo.
    this.value = (e.target as HTMLInputElement).value;
    this._emit(this.value);
  };

  private _onKeydown = (e: KeyboardEvent) => {
    // Escape clears in-place; gate on the live input value (it can lead
    // ``value`` by a keystroke) and stop it bubbling to a parent drawer.
    if (e.key === "Escape" && this._input?.value) {
      e.stopPropagation();
      this._clear();
    }
  };

  private _clear = () => {
    // Reflect the cleared state immediately, before the parent echoes it.
    this.value = "";
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
