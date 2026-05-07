/**
 * Inline "Create new label" affordance — shared by the device-drawer
 * label editor and the dashboard's labels filter.
 *
 * Renders as a collapsed toggle button by default; clicking expands
 * an in-place form (name input + color-swatch radiogroup + submit /
 * cancel buttons) that round-trips to ``labels/create`` and emits a
 * ``label-created`` ``CustomEvent<Label>`` once the backend
 * acknowledges. The host owns whatever happens next (assigning the
 * label to a device, selecting it in a filter, etc.) — this
 * component only knows how to mint a new ``Label``.
 *
 * Extracted so the dashboard's labels filter can offer creation in
 * its empty state (and after, via a popover footer) without
 * duplicating the form layout, validation, swatch keyboard nav, or
 * the toast-on-failure plumbing the editor already had.
 */
import { consume } from "@lit/context";
import { mdiCheck, mdiPlus } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { Label } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { LABEL_COLOR_SWATCHES } from "../../util/label-style.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/input/input.js";

registerMdiIcons({
  check: mdiCheck,
  plus: mdiPlus,
});

@customElement("esphome-label-create-form")
export class ESPHomeLabelCreateForm extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  @state()
  private _api?: ESPHomeAPI;

  /** Existing label names to dedup against (case-insensitive). The
   *  caller passes the ``Label[]`` catalog so the form can refuse a
   *  duplicate before the backend rejects it — the backend dedup is
   *  authoritative, this is just a UX guard. */
  @property({ attribute: false })
  existingNames: string[] = [];

  /** Pre-fill the name input when expanding. Useful when "filter to
   *  find" turned into "didn't exist, create it" and we already
   *  have the user's typed-but-unmatched search string. */
  @property({ attribute: false })
  nameSeed = "";

  /** Render expanded by default. The labels filter's empty popover
   *  passes ``true`` so a freshly-installed dashboard doesn't show
   *  the "click to expand" indirection — there's nothing else in
   *  the popover anyway. */
  @property({ type: Boolean, attribute: "default-open", reflect: true })
  defaultOpen = false;

  /** Hide the form's surrounding "Create new label" header label
   *  inside the form body. The standalone toggle-button text is
   *  enough context in the labels-filter empty state, where the
   *  popover already says "Labels". */
  @property({ type: Boolean, attribute: "compact" })
  compact = false;

  @state()
  private _open = false;

  @state()
  private _name = "";

  @state()
  private _color: string | null = null;

  @state()
  private _saving = false;

  /** Open the form when ``defaultOpen`` flips true — handles both
   *  the initial render (Lit fires ``willUpdate`` before the first
   *  paint with every reactive property in *changed*) and a later
   *  flip (e.g. the labels-filter rebinding ``default-open`` when
   *  the catalog drains back to zero). Routes through ``expand()``
   *  so ``nameSeed`` is honoured the same way it would be from a
   *  manual click on the toggle button — both expansion paths must
   *  agree, otherwise a host that uses ``default-open`` to start
   *  expanded would silently lose the seed. We deliberately
   *  *don't* auto-collapse on becomes-false: a host that flips it
   *  (e.g. catalog growing past zero after a create) shouldn't
   *  yank a half-typed form out from under the user — the user
   *  can Cancel themselves. */
  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has("defaultOpen") && this.defaultOpen && !this._open) {
      this.expand();
    }
  }

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
      }

      .create-toggle {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 6px 8px;
        background: transparent;
        border: none;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--esphome-primary);
        cursor: pointer;
        align-self: flex-start;
        font-family: inherit;
      }

      .create-toggle wa-icon {
        font-size: 14px;
      }

      .create-form {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-s);
        padding: var(--wa-space-s) 0;
      }

      .create-form-label {
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-quiet);
      }

      .swatch-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .swatch {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        cursor: pointer;
        padding: 0;
      }

      .swatch--selected {
        outline: 2px solid var(--esphome-primary);
        outline-offset: 2px;
      }

      .swatch--clear {
        background: transparent;
        color: var(--wa-color-text-quiet);
        font-size: 12px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .create-actions {
        display: flex;
        gap: var(--wa-space-xs);
        justify-content: flex-end;
      }

      .btn {
        padding: 6px 14px;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        border-radius: var(--wa-border-radius-s);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: var(--wa-color-surface-default);
        color: var(--wa-color-text-normal);
        cursor: pointer;
        font-family: inherit;
      }

      .btn--primary {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
        border-color: var(--esphome-primary);
      }

      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
  ];

  /** Open the form programmatically. Hosts that drive the open
   *  state externally (e.g. seeding from a filter input) can call
   *  this rather than poking ``_open`` via DOM. */
  expand(seed = "") {
    this._name = seed || this.nameSeed;
    this._open = true;
  }

  /** Collapse the form and reset transient state. Called after a
   *  successful create and from the in-form Cancel button. */
  collapse() {
    this._open = false;
    this._name = "";
    this._color = null;
  }

  protected render() {
    if (!this._open) {
      // ``aria-expanded`` + ``aria-controls`` advertise the
      // disclosure relationship to assistive tech: the toggle
      // reveals the form below it (which carries id ``create-form``
      // when expanded), and a screen reader user gets to hear that
      // the button reveals further controls instead of just
      // landing on a bare "Create new label" button with no hint
      // about what happens on click.
      return html`<button
        class="create-toggle"
        type="button"
        aria-expanded="false"
        aria-controls="create-form"
        @click=${() => this.expand()}
      >
        <wa-icon library="mdi" name="plus"></wa-icon>
        ${this._localize("dashboard.labels_create")}
      </button>`;
    }
    const trimmed = this._name.trim();
    const lowerExisting = this.existingNames.map((n) => n.toLowerCase());
    const duplicate = lowerExisting.includes(trimmed.toLowerCase());
    // ``_api`` is consumed from context; it's typically present once
    // the dashboard has finished its connect dance, but during the
    // initial WS handshake the context may still be undefined. Gate
    // the submit button on it so we don't enable a control whose
    // click would silently no-op.
    const canCreate =
      trimmed.length > 0 &&
      trimmed.length <= 50 &&
      !duplicate &&
      !this._saving &&
      !!this._api;
    const values: (string | null)[] = [null, ...LABEL_COLOR_SWATCHES];
    return html`
      <form
        id="create-form"
        class="create-form"
        @submit=${(e: Event) => {
          e.preventDefault();
          if (canCreate) void this._submit();
        }}
      >
        ${this.compact
          ? nothing
          : html`<span class="create-form-label"
              >${this._localize("dashboard.labels_create")}</span
            >`}
        <wa-input
          placeholder=${this._localize("dashboard.labels_create_placeholder")}
          maxlength="50"
          .value=${this._name}
          aria-label=${this._localize("dashboard.labels_create")}
          @input=${(e: Event) => {
            this._name = (e.currentTarget as unknown as { value: string }).value;
          }}
        ></wa-input>
        <div
          class="swatch-row"
          role="radiogroup"
          aria-label=${this._localize("dashboard.labels_color")}
          @keydown=${(e: KeyboardEvent) => this._onSwatchKeyDown(e, values)}
        >
          ${values.map((c) => {
            const selected = this._color === c;
            if (c === null) {
              return html`<button
                type="button"
                role="radio"
                aria-checked=${selected ? "true" : "false"}
                tabindex=${selected ? "0" : "-1"}
                class="swatch swatch--clear ${selected ? "swatch--selected" : ""}"
                aria-label=${this._localize("dashboard.labels_color_none")}
                title=${this._localize("dashboard.labels_color_none")}
                @click=${() => {
                  this._color = null;
                }}
              >
                ${selected
                  ? html`<wa-icon library="mdi" name="check"></wa-icon>`
                  : nothing}
              </button>`;
            }
            return html`<button
              type="button"
              role="radio"
              aria-checked=${selected ? "true" : "false"}
              tabindex=${selected ? "0" : "-1"}
              class="swatch ${selected ? "swatch--selected" : ""}"
              style="background:${c}"
              aria-label=${c}
              title=${c}
              @click=${() => {
                this._color = c;
              }}
            ></button>`;
          })}
        </div>
        <div class="create-actions">
          <button
            type="button"
            class="btn"
            @click=${() => this._cancel()}
          >
            ${this._localize("dashboard.labels_create_cancel")}
          </button>
          <button
            type="submit"
            class="btn btn--primary"
            ?disabled=${!canCreate}
          >
            ${this._localize("dashboard.labels_create_submit")}
          </button>
        </div>
      </form>
    `;
  }

  private _cancel() {
    // The labels filter's empty popover relies on the form staying
    // visible, so when ``defaultOpen`` is set we never collapse —
    // we just blank the inputs. Hosts that want a real "close"
    // behaviour leave ``defaultOpen`` false (the editor's dialog
    // does this).
    if (this.defaultOpen) {
      this._name = "";
      this._color = null;
      return;
    }
    this.collapse();
  }

  private async _submit() {
    // Re-entry guard. ``canCreate`` already gates the submit
    // button on ``!this._saving``, but the ``@submit`` handler's
    // closure captures whichever ``canCreate`` was active in the
    // last render — a fast double-click / Enter before Lit has
    // re-rendered the disabled state can route two submits
    // through here and mint duplicate labels. The check on
    // ``_saving`` makes that race harmless regardless of UI
    // timing.
    if (this._saving) return;
    if (!this._api) return;
    const name = this._name.trim();
    if (!name) return;
    // Fire ``submitting`` *before* the round trip so a host that
    // owns per-context state (the device-labels editor's "is the
    // user still on the same device?" check) can snapshot before
    // the await. The event has no detail; the host already knows
    // its own context.
    this.dispatchEvent(
      new CustomEvent("submitting", { bubbles: true, composed: true }),
    );
    this._saving = true;
    try {
      const created = await this._api.createLabel({
        name,
        color: this._color,
      });
      this.dispatchEvent(
        new CustomEvent<Label>("label-created", {
          detail: created,
          bubbles: true,
          composed: true,
        }),
      );
      this._name = "";
      this._color = null;
      if (!this.defaultOpen) this._open = false;
    } catch (err) {
      console.warn("label create failed", err);
      toast.error(this._localize("dashboard.labels_create_failed"), {
        richColors: true,
      });
    } finally {
      this._saving = false;
    }
  }

  /** Roving-tabindex keyboard nav across the colour swatches —
   *  matches the WAI-ARIA radiogroup pattern (only the selected
   *  swatch is in the tab order; arrow keys move focus + selection
   *  through the row). Arrow / Home / End wrap inside the row. */
  private _onSwatchKeyDown(e: KeyboardEvent, values: (string | null)[]) {
    let idx = values.indexOf(this._color);
    if (idx < 0) idx = 0;
    let next = idx;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (idx + 1) % values.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (idx - 1 + values.length) % values.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = values.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    this._color = values[next];
    requestAnimationFrame(() => {
      const swatch = this.renderRoot.querySelectorAll<HTMLButtonElement>(
        ".swatch",
      )[next];
      swatch?.focus();
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-label-create-form": ESPHomeLabelCreateForm;
  }
}
