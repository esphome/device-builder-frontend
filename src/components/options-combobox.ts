/**
 * Reusable combobox: a dropdown of options that shows the whole list on
 * open, filters as you type, and accepts arbitrary typed values
 * (pre-filled with the current value). Fills the gap left by the native
 * `<input list=datalist>`, which filters its suggestions by the text
 * already in the field, so a pre-filled field can't browse the full
 * list. `<wa-combobox>` is not available in HA's webawesome fork.
 *
 * `wa-popup` is pure positioning (the input keeps focus, unlike
 * `wa-dropdown` which moves focus into the menu). Emits
 * `options-combobox-change` on every keystroke and on option select.
 */
import { mdiChevronDown } from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { inputStyles } from "../styles/inputs.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { buildOptionsComboboxChangeEvent } from "./options-combobox-event.js";
import { optionsComboboxStyles } from "./options-combobox.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/popup/popup.js";

registerMdiIcons({ "chevron-down": mdiChevronDown });

export interface ComboboxOption {
  label: string;
  value: string;
}

@customElement("esphome-options-combobox")
export class ESPHomeOptionsCombobox extends LitElement {
  /** Selectable options; the list also accepts free-text not in here. */
  @property({ attribute: false })
  options: ComboboxOption[] = [];

  /** Committed value — an option value or arbitrary typed text. */
  @property()
  value = "";

  @property()
  placeholder = "";

  @property({ type: Boolean })
  disabled = false;

  /** Error styling on the control border. */
  @property({ type: Boolean })
  invalid = false;

  /** Accessible name for the input. */
  @property()
  label = "";

  /** Open state of the dropdown. */
  @state() private _open = false;

  /** Text shown while editing; the closed field shows ``value``. */
  @state() private _query = "";

  /** Typed since opening — gates show-all (false) vs substring filter. */
  @state() private _dirty = false;

  /** Keyboard-active option index into the filtered list, or -1. */
  @state() private _active = -1;

  /** Committed value snapshotted when the dropdown opened, so Escape can
   *  restore it even after per-keystroke ``options-combobox-change`` has
   *  driven the host to update ``value``. */
  private _committed = "";

  @query("input")
  private _input?: HTMLInputElement;

  @query(".option--active")
  private _activeOption?: HTMLElement;

  static styles = [inputStyles, optionsComboboxStyles];

  protected render() {
    const filtered = this._filtered;
    const display = this._open ? this._query : this.value;
    // Reflects whether the listbox is actually shown — the popup only
    // activates with matches, so ARIA must track the same condition.
    const expanded = this._open && filtered.length > 0;
    // Only point aria-activedescendant at a row that's actually rendered —
    // never when collapsed, never out of the (possibly newly-filtered) range.
    const activeId =
      expanded && this._active >= 0 && this._active < filtered.length
        ? `option-${this._active}`
        : nothing;
    return html`
      <wa-popup placement="bottom-start" sync="width" distance="4" ?active=${expanded}>
        <div slot="anchor" class="control">
          <input
            type="text"
            class=${this.invalid ? "invalid" : ""}
            role="combobox"
            aria-autocomplete="list"
            aria-invalid=${this.invalid ? "true" : nothing}
            aria-expanded=${expanded ? "true" : "false"}
            aria-controls=${expanded ? "listbox" : nothing}
            aria-activedescendant=${activeId}
            aria-label=${this.label || nothing}
            .value=${display}
            placeholder=${this.placeholder}
            ?disabled=${this.disabled}
            autocomplete="off"
            spellcheck="false"
            @focus=${this._open_}
            @input=${this._onInput}
            @keydown=${this._onKeyDown}
            @blur=${this._close}
          />
          <button
            class="chevron"
            type="button"
            tabindex="-1"
            ?disabled=${this.disabled}
            aria-hidden="true"
            @mousedown=${this._preventBlur}
            @click=${this._toggle}
          >
            <wa-icon library="mdi" name="chevron-down"></wa-icon>
          </button>
        </div>
        ${expanded
          ? html`<div
              id="listbox"
              class="listbox"
              role="listbox"
              @mousedown=${this._preventBlur}
            >
              ${filtered.map(
                (opt, i) =>
                  html`<div
                    id="option-${i}"
                    class="option ${i === this._active ? "option--active" : ""}"
                    role="option"
                    aria-selected=${opt.value === this.value ? "true" : "false"}
                    @mousedown=${this._preventBlur}
                    @click=${() => this._select(opt)}
                    @mouseenter=${() => (this._active = i)}
                  >
                    <span class="option-label">${opt.label}</span>
                  </div>`
              )}
            </div>`
          : nothing}
      </wa-popup>
    `;
  }

  private get _filtered(): ComboboxOption[] {
    if (!this._dirty) return this.options;
    const q = this._query.trim().toLowerCase();
    if (!q) return this.options;
    return this.options.filter(
      (o) => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)
    );
  }

  private _open_ = () => {
    if (this.disabled || this._open) return;
    this._open = true;
    this._committed = this.value;
    this._query = this.value;
    this._dirty = false;
    // Highlight the current value and scroll it into view, so a pre-filled
    // field opens focused on its own selection instead of the top of the
    // list; arrow keys then move relative to it. -1 (nothing active) when
    // the value is free text not in the options.
    this._active = this.options.findIndex((o) => o.value === this.value);
    if (this._active >= 0) this._scrollActiveIntoView();
  };

  private _close = () => {
    this._open = false;
    this._active = -1;
    // Clear the edit flag too: a close that left it set (Escape / blur after
    // typing) would make the next keystroke filter against the stale query
    // before the reopen resets it. _open_ sets it false on every open anyway.
    this._dirty = false;
  };

  private _toggle = () => {
    if (this.disabled) return;
    if (this._open) {
      this._close();
    } else {
      this._open_();
      this._input?.focus();
    }
  };

  /** Keep focus on the input so a click on the chevron / an option doesn't
   *  blur-close the popup before the click registers. */
  private _preventBlur = (e: Event) => e.preventDefault();

  private _onInput = (e: Event) => {
    const value = (e.target as HTMLInputElement).value;
    this._query = value;
    this._dirty = true;
    this._open = true;
    this._active = -1;
    this._emit(value);
  };

  private _onKeyDown = (e: KeyboardEvent) => {
    const filtered = this._filtered;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!this._open) this._open_();
        if (filtered.length) {
          this._active = this._active >= filtered.length - 1 ? 0 : this._active + 1;
          this._scrollActiveIntoView();
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!this._open) this._open_();
        if (filtered.length) {
          this._active = this._active <= 0 ? filtered.length - 1 : this._active - 1;
          this._scrollActiveIntoView();
        }
        break;
      case "Enter":
        if (this._open && this._active >= 0 && filtered[this._active]) {
          e.preventDefault();
          this._select(filtered[this._active]);
        } else {
          this._close();
        }
        break;
      case "Escape":
        if (this._open) {
          // Don't let Escape bubble to a parent dialog's dismiss handler.
          e.preventDefault();
          e.stopPropagation();
          // Restore the value the field held when it opened and emit it, so
          // a host that committed each keystroke reverts too (Escape cancels
          // the edit, not just the local text).
          this.value = this._committed;
          this._query = this._committed;
          this._emit(this._committed);
          this._close();
        }
        break;
      case "Tab":
        this._close();
        break;
    }
  };

  private _select(opt: ComboboxOption): void {
    // The input keeps focus on its own (option rows preventDefault the
    // blur), so no refocus here — refocusing would re-fire ``@focus`` and
    // reopen the popup we're closing.
    this.value = opt.value;
    this._query = opt.value;
    this._emit(opt.value);
    this._close();
  }

  private _emit(value: string): void {
    this.dispatchEvent(buildOptionsComboboxChangeEvent(value));
  }

  private _scrollActiveIntoView(): void {
    // Wait for the re-render so the @query ref resolves to the new active row.
    void this.updateComplete.then(() =>
      this._activeOption?.scrollIntoView({ block: "nearest" })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-options-combobox": ESPHomeOptionsCombobox;
  }
}
