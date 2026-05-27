/**
 * MDI icon picker.
 *
 * Replaces the plain `mdi:foo-bar` text input with a visual browser:
 * a trigger button shows the currently selected icon, clicking it opens
 * a dropdown panel with a search box and a grid of every icon in
 * `@mdi/js`. The full icon set is ~2.8MB, so it's lazy-loaded via
 * dynamic import only when the picker is opened for the first time.
 *
 * Emits a `change` CustomEvent with `{ value: "mdi:icon-name" | "" }`.
 */
import { mdiClose, mdiMagnify, mdiPalette } from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { inputStyles } from "../styles/inputs.js";
import { EscapeController } from "../util/escape-controller.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  close: mdiClose,
  magnify: mdiMagnify,
  palette: mdiPalette,
});

interface IconEntry {
  /** kebab-case name shown to the user (e.g. `account-multiple`). */
  name: string;
  /** SVG path data. */
  path: string;
}

let catalogPromise: Promise<IconEntry[]> | null = null;

/**
 * Lazy-load `@mdi/js` and convert its `mdiAccountMultiple = "..."` exports
 * into `[{ name: "account-multiple", path: "..." }]`. Cached after first
 * call so re-opening the picker is instant.
 */
function loadCatalog(): Promise<IconEntry[]> {
  if (catalogPromise) return catalogPromise;
  catalogPromise = (async () => {
    const mod = (await import("@mdi/js")) as unknown as Record<string, unknown>;
    const list: IconEntry[] = [];
    for (const [exportName, path] of Object.entries(mod)) {
      if (!exportName.startsWith("mdi") || typeof path !== "string") continue;
      // mdiAccountMultiple → AccountMultiple → account-multiple
      const stripped = exportName.slice(3);
      if (!stripped) continue;
      const kebab = stripped
        .replace(/^[A-Z]/, (c) => c.toLowerCase())
        .replace(/([A-Z])/g, "-$1")
        .replace(/_/g, "-")
        .toLowerCase();
      list.push({ name: kebab, path: path as string });
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  })().catch((err) => {
    console.error("[mdi-icon-picker] failed to load catalog:", err);
    catalogPromise = null;
    return [];
  });
  return catalogPromise;
}

/** Strip the `mdi:` prefix from `value`; tolerate either form on input. */
function normalizeName(value: string): string {
  if (!value) return "";
  return value.startsWith("mdi:") ? value.slice(4) : value;
}

const MAX_RESULTS = 400;

/**
 * Rank icons against a query. Empty query → alphabetical. Otherwise
 * exact-name first, then prefix matches, then substring — within each
 * tier the original alphabetical order is preserved.
 */
function searchIcons(catalog: IconEntry[], query: string): IconEntry[] {
  if (!query) return catalog.slice(0, MAX_RESULTS);
  const q = query.trim().toLowerCase().replace(/\s+/g, "-");
  if (!q) return catalog.slice(0, MAX_RESULTS);
  const exact: IconEntry[] = [];
  const prefix: IconEntry[] = [];
  const substring: IconEntry[] = [];
  for (const entry of catalog) {
    if (entry.name === q) exact.push(entry);
    else if (entry.name.startsWith(q)) prefix.push(entry);
    else if (entry.name.includes(q)) substring.push(entry);
    if (exact.length + prefix.length + substring.length >= MAX_RESULTS * 2) break;
  }
  return [...exact, ...prefix, ...substring].slice(0, MAX_RESULTS);
}

@customElement("esphome-mdi-icon-picker")
export class ESPHomeMdiIconPicker extends LitElement {
  /** Current value, e.g. `"mdi:plus"`. Empty means no selection. */
  @property() value = "";

  /** Optional placeholder shown when no icon is selected. */
  @property() placeholder = "Choose an icon…";

  @property({ type: Boolean }) invalid = false;

  @property({ type: Boolean }) disabled = false;

  @state() private _open = false;

  @state() private _catalog: IconEntry[] = [];

  @state() private _query = "";

  @state() private _loaded = false;

  @query(".search-input") private _searchInput?: HTMLInputElement;

  static styles = [
    inputStyles,
    css`
      :host {
        display: block;
        position: relative;
      }

      /* Trigger — shaped like the project's standard input */
      .trigger {
        width: 100%;
        box-sizing: border-box;
        min-height: var(--wa-form-control-height);
        padding: 0 14px;
        font-size: var(--wa-font-size-s);
        font-family: inherit;
        line-height: var(--wa-form-control-value-line-height);
        color: var(--wa-color-text-normal);
        background: var(--wa-color-surface-raised);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        outline: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 10px;
        text-align: left;
        transition:
          border-color 0.15s,
          box-shadow 0.15s;
      }

      .trigger:focus,
      :host([open]) .trigger {
        border-color: var(--esphome-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--esphome-primary), transparent 80%);
      }

      .trigger.invalid {
        border-color: var(--esphome-error);
      }

      .trigger.invalid:focus {
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--esphome-error), transparent 80%);
      }

      .trigger:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .trigger-icon {
        width: 22px;
        height: 22px;
        flex: 0 0 22px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--wa-border-radius-s);
        background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
        color: var(--esphome-primary);
      }

      .trigger-icon svg {
        width: 16px;
        height: 16px;
      }

      .trigger-icon--empty {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-quiet);
      }

      .trigger-label {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--wa-font-family-code, monospace);
        font-size: var(--wa-font-size-s);
      }

      .trigger-label.placeholder {
        color: var(--wa-color-text-quiet);
        font-family: inherit;
      }

      .trigger-clear {
        background: none;
        border: none;
        padding: 4px;
        cursor: pointer;
        color: var(--wa-color-text-quiet);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--wa-border-radius-s);
      }

      .trigger-clear:hover {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
      }

      .trigger-chevron {
        width: 14px;
        height: 14px;
        color: var(--wa-color-text-quiet);
        flex: 0 0 14px;
        transition: transform 0.15s;
      }

      :host([open]) .trigger-chevron {
        transform: rotate(180deg);
      }

      /* Panel */
      .panel {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        max-height: 380px;
        background: var(--wa-color-surface-raised);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        box-shadow:
          0 8px 24px rgba(0, 0, 0, 0.12),
          0 2px 6px rgba(0, 0, 0, 0.06);
        overflow: hidden;
        animation: panelIn 0.12s ease-out;
      }

      @keyframes panelIn {
        from {
          opacity: 0;
          transform: translateY(-4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .search {
        position: relative;
        padding: 10px 12px;
        border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .search-icon {
        position: absolute;
        left: 22px;
        top: 50%;
        transform: translateY(-50%);
        width: 14px;
        height: 14px;
        color: var(--wa-color-text-quiet);
        pointer-events: none;
      }

      .search-input {
        width: 100%;
        box-sizing: border-box;
        padding: 7px 10px 7px 32px !important;
        min-height: 32px !important;
        font-size: var(--wa-font-size-s);
      }

      .grid-wrap {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
        gap: 4px;
      }

      .icon-cell {
        position: relative;
        aspect-ratio: 1;
        background: none;
        border: 1px solid transparent;
        border-radius: var(--wa-border-radius-s);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--wa-color-text-normal);
        padding: 0;
        transition:
          background 0.1s,
          border-color 0.1s,
          color 0.1s,
          transform 0.08s;
      }

      .icon-cell svg {
        width: 20px;
        height: 20px;
      }

      .icon-cell:hover {
        background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
        color: var(--esphome-primary);
        border-color: color-mix(in srgb, var(--esphome-primary), transparent 70%);
        transform: scale(1.06);
      }

      .icon-cell--selected {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .icon-cell--selected:hover {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
        transform: scale(1.06);
      }

      .empty,
      .loading {
        padding: 24px 16px;
        text-align: center;
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
      }

      .footer {
        padding: 6px 12px;
        border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .footer-name {
        font-family: var(--wa-font-family-code, monospace);
        color: var(--wa-color-text-normal);
        font-size: var(--wa-font-size-xs);
      }
    `,
  ];

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("click", this._onDocumentClick, true);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("click", this._onDocumentClick, true);
  }

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has("_open")) this._escape.set(this._open);
    // When the picker is mounted (or assigned a value) with an icon
    // already selected, kick off the catalog load so the trigger button
    // can render the SVG. Otherwise the form would open showing only a
    // placeholder until the user clicks the dropdown.
    if (changed.has("value") && !this._loaded && normalizeName(this.value)) {
      void this._ensureCatalogLoaded();
    }
  }

  /* Esc binds to ``document`` (not ``window``) and the callback uses
     ``stopPropagation`` so a parent dialog wrapping the picker doesn't
     also close on the same keypress. */
  private _escape = new EscapeController(
    this,
    (e) => {
      e.stopPropagation();
      this._close();
    },
    { target: document }
  );

  private _onDocumentClick = (e: Event) => {
    if (!this._open) return;
    const path = e.composedPath();
    if (!path.includes(this)) {
      this._close();
    }
  };

  private async _toggle() {
    if (this.disabled) return;
    if (this._open) {
      this._close();
    } else {
      await this._openPanel();
    }
  }

  private async _openPanel() {
    this._open = true;
    this.setAttribute("open", "");
    await this._ensureCatalogLoaded();
    await this.updateComplete;
    this._searchInput?.focus();
  }

  private async _ensureCatalogLoaded() {
    if (this._loaded) return;
    this._catalog = await loadCatalog();
    this._loaded = true;
  }

  private _close() {
    this._open = false;
    this.removeAttribute("open");
    this._query = "";
  }

  private _select(name: string) {
    const next = `mdi:${name}`;
    this.value = next;
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { value: next },
        bubbles: true,
        composed: true,
      })
    );
    this._close();
  }

  private _clear(e: Event) {
    e.stopPropagation();
    this.value = "";
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { value: "" },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onSearchInput(e: Event) {
    this._query = (e.target as HTMLInputElement).value;
  }

  private _renderTriggerIcon() {
    const name = normalizeName(this.value);
    if (!name) {
      return html`<span class="trigger-icon trigger-icon--empty">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d=${mdiPalette}></path>
        </svg>
      </span>`;
    }
    const entry = this._catalog.find((e) => e.name === name);
    if (entry) {
      return html`<span class="trigger-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d=${entry.path}></path>
        </svg>
      </span>`;
    }
    // Fall back to wa-icon's MDI library; it'll resolve if the icon was
    // registered, otherwise just show the placeholder background.
    return html`<span class="trigger-icon">
      <wa-icon library="mdi" name=${name} style="font-size: 16px;"></wa-icon>
    </span>`;
  }

  private _renderPanel() {
    if (!this._loaded) {
      return html`<div class="panel" @click=${(e: Event) => e.stopPropagation()}>
        <div class="loading">Loading icons…</div>
      </div>`;
    }

    const results = searchIcons(this._catalog, this._query);
    const selectedName = normalizeName(this.value);

    return html`
      <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
        <div class="search">
          <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d=${mdiMagnify}></path>
          </svg>
          <input
            type="text"
            class="search-input"
            placeholder="Search ${this._catalog.length.toLocaleString()} icons…"
            .value=${this._query}
            @input=${this._onSearchInput}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter" && results.length > 0) {
                e.preventDefault();
                this._select(results[0].name);
              }
            }}
          />
        </div>
        <div class="grid-wrap">
          ${results.length === 0
            ? html`<div class="empty">
                <wa-icon library="mdi" name="magnify" style="font-size: 24px;"></wa-icon>
                No icons match “${this._query}”
              </div>`
            : html`<div class="grid">
                ${results.map(
                  (entry) => html`
                    <button
                      type="button"
                      class=${entry.name === selectedName
                        ? "icon-cell icon-cell--selected"
                        : "icon-cell"}
                      title=${`mdi:${entry.name}`}
                      @click=${() => this._select(entry.name)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="currentColor" d=${entry.path}></path>
                      </svg>
                    </button>
                  `
                )}
              </div>`}
        </div>
        <div class="footer">
          <span>
            ${results.length === 0
              ? "No matches"
              : results.length >= MAX_RESULTS
                ? `${MAX_RESULTS}+ of ${this._catalog.length.toLocaleString()}`
                : `${results.length} of ${this._catalog.length.toLocaleString()}`}
          </span>
          ${selectedName
            ? html`<span class="footer-name">mdi:${selectedName}</span>`
            : nothing}
        </div>
      </div>
    `;
  }

  protected render() {
    const name = normalizeName(this.value);
    const triggerClass = `trigger${this.invalid ? " invalid" : ""}`;
    return html`
      <button
        type="button"
        class=${triggerClass}
        ?disabled=${this.disabled}
        @click=${this._toggle}
      >
        ${this._renderTriggerIcon()}
        <span class=${name ? "trigger-label" : "trigger-label placeholder"}>
          ${name ? `mdi:${name}` : this.placeholder}
        </span>
        ${name && !this.disabled
          ? html`<span
              class="trigger-clear"
              role="button"
              tabindex="-1"
              title="Clear"
              @click=${this._clear}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d=${mdiClose}></path>
              </svg>
            </span>`
          : nothing}
        <svg class="trigger-chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M7,10L12,15L17,10H7Z"></path>
        </svg>
      </button>
      ${this._open ? this._renderPanel() : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-mdi-icon-picker": ESPHomeMdiIconPicker;
  }
}
