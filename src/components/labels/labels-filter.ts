/**
 * Filter affordance that narrows the device list to entries
 * carrying every selected label (logical AND).
 *
 * Sits next to the search input in the dashboard toolbar. Hidden
 * when the catalog is empty so an un-tagged fleet doesn't see a
 * dead button. The component owns no filter state itself —
 * selections live on the parent dashboard so the device-filter
 * logic, the URL query string, and the empty-state copy can all
 * read from a single source. Selection changes are emitted as a
 * ``labels-filter-change`` ``CustomEvent<string[]>`` carrying the
 * new full set of selected ids.
 */
import { consume } from "@lit/context";
import {
  mdiCheck,
  mdiTagMultipleOutline,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Label } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { labelsContext, localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { EscapeController } from "../../util/escape-controller.js";
import {
  labelChipStyles,
} from "../../util/label-chip-template.js";
import { labelChipStyleString } from "../../util/label-style.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  check: mdiCheck,
  "tag-multiple-outline": mdiTagMultipleOutline,
});

@customElement("esphome-labels-filter")
export class ESPHomeLabelsFilter extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: labelsContext, subscribe: true })
  @state()
  private _catalog: Label[] = [];

  /** Currently-selected label ids. Source of truth lives on the
   *  parent (dashboard) so we don't drift with router state /
   *  query-string serialization later. */
  @property({ attribute: false })
  selected: string[] = [];

  @state()
  private _open = false;

  private _escape = new EscapeController(this, (e) => {
    e.preventDefault();
    this._close();
  });

  static styles = [
    espHomeStyles,
    labelChipStyles,
    css`
      :host {
        display: inline-block;
        position: relative;
      }

      /* Match the dashboard's other icon-button affordances
         ('select-toggle-btn' + segmented 'view-toggle-btn'): 36px
         square, neutral fill, primary fill when active. The active
         count rides as a small badge in the upper-right corner so
         the button stays icon-sized at any selection count. */
      .trigger {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: var(--wa-border-radius-m);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: var(--wa-color-surface-raised);
        color: var(--wa-color-text-quiet);
        cursor: pointer;
        transition:
          background 0.12s,
          color 0.12s,
          border-color 0.12s;
        padding: 0;
        flex-shrink: 0;
      }

      .trigger:hover {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
      }

      .trigger--active {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
        border-color: var(--esphome-primary);
      }

      .trigger--active:hover {
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
      }

      .trigger wa-icon {
        font-size: 18px;
      }

      .count-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 16px;
        height: 16px;
        padding: 0 4px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: var(--wa-font-weight-bold);
        line-height: 1;
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
        border: 2px solid var(--wa-color-surface-default);
      }

      /* When the button itself is filled (active state), the badge
         needs the inverse outline to stay distinct. */
      .trigger--active .count-badge {
        background: var(--wa-color-surface-default);
        color: var(--esphome-primary);
        border-color: var(--esphome-primary);
      }

      .popover {
        position: absolute;
        z-index: 10;
        top: calc(100% + 4px);
        left: 0;
        min-width: 220px;
        max-width: 320px;
        background: var(--wa-color-surface-default);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        box-shadow: var(--wa-shadow-m);
        padding: var(--wa-space-xs);
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 320px;
        overflow-y: auto;
      }

      .option {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 6px;
        border: none;
        background: transparent;
        text-align: left;
        border-radius: var(--wa-border-radius-s);
        cursor: pointer;
        color: inherit;
      }

      .option:hover {
        background: var(--wa-color-surface-lowered);
      }

      .option-check {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        border-radius: 4px;
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        flex-shrink: 0;
        color: var(--esphome-on-primary);
      }

      .option-check--checked {
        background: var(--esphome-primary);
        border-color: var(--esphome-primary);
      }

      .option-check wa-icon {
        font-size: 12px;
      }

      .clear {
        padding: 4px 6px;
        border: none;
        background: transparent;
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--esphome-primary);
        cursor: pointer;
        border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        margin-top: 4px;
        text-align: left;
      }

      .empty {
        text-align: center;
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
        padding: var(--wa-space-s);
      }
    `,
  ];

  protected willUpdate(changed: Map<string, unknown>) {
    // If the catalog drains while the popover is open (last label
    // deleted via a push event), force-close so we don't leave the
    // EscapeController bound and the component in an
    // open-but-unrenderable state — ``render()`` returns ``nothing``
    // on an empty catalog, so without this the popover is invisible
    // but keystrokes still pretend to dismiss it.
    if (
      changed.has("_catalog") &&
      this._catalog.length === 0 &&
      this._open
    ) {
      this._open = false;
    }
    if (changed.has("_open")) this._escape.set(this._open);
  }

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener("click", this._onDocumentClick, true);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("click", this._onDocumentClick, true);
  }

  private _onDocumentClick = (e: MouseEvent) => {
    if (!this._open) return;
    if (e.composedPath().includes(this)) return;
    this._close();
  };

  protected render() {
    if (this._catalog.length === 0) return nothing;
    const selectedSet = new Set(this.selected);
    const count = this.selected.length;
    const label = this._localize("dashboard.filter_labels");
    return html`
      <button
        class="trigger ${count > 0 ? "trigger--active" : ""}"
        type="button"
        title=${label}
        aria-label=${label}
        aria-haspopup="true"
        aria-expanded=${this._open ? "true" : "false"}
        @click=${this._toggle}
      >
        <wa-icon library="mdi" name="tag-multiple-outline"></wa-icon>
        ${count > 0
          ? html`<span class="count-badge" aria-hidden="true">${count}</span>`
          : nothing}
      </button>
      ${this._open ? this._renderPopover(selectedSet) : nothing}
    `;
  }

  private _renderPopover(selectedSet: Set<string>) {
    return html`
      <div
        class="popover"
        role="group"
        aria-label=${this._localize("dashboard.filter_labels")}
      >
        ${this._catalog.length === 0
          ? html`<div class="empty">
              ${this._localize("dashboard.labels_no_matches")}
            </div>`
          : this._catalog.map((label) => {
              const checked = selectedSet.has(label.id);
              return html`<button
                class="option"
                type="button"
                role="checkbox"
                aria-checked=${checked ? "true" : "false"}
                @click=${() => this._toggleLabel(label.id, !checked)}
              >
                <span class="option-check ${checked ? "option-check--checked" : ""}">
                  ${checked
                    ? html`<wa-icon library="mdi" name="check"></wa-icon>`
                    : nothing}
                </span>
                <span class="label-chip" style=${labelChipStyleString(label.color)}
                  >${label.name}</span
                >
              </button>`;
            })}
        ${this.selected.length > 0
          ? html`<button class="clear" type="button" @click=${this._clear}>
              ${this._localize("dashboard.filter_clear")}
            </button>`
          : nothing}
      </div>
    `;
  }

  private _toggle = () => {
    this._open = !this._open;
  };

  private _close() {
    if (this._open) this._open = false;
  }

  private _emit(next: string[]) {
    this.dispatchEvent(
      new CustomEvent<string[]>("labels-filter-change", {
        detail: next,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _toggleLabel(labelId: string, select: boolean) {
    if (select) {
      if (this.selected.includes(labelId)) return;
      this._emit([...this.selected, labelId]);
    } else {
      this._emit(this.selected.filter((id) => id !== labelId));
    }
  }

  private _clear = () => {
    this._emit([]);
    this._open = false;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-labels-filter": ESPHomeLabelsFilter;
  }
}
