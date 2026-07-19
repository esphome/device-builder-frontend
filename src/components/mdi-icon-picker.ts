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
import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { inputStyles } from "../styles/inputs.js";
import { textStyles } from "../styles/text.js";
import { fireEvent } from "../util/fire-event.js";
import { LightDismissController } from "../util/light-dismiss-controller.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { mdiIconPickerStyles } from "./mdi-icon-picker.styles.js";

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

  static styles = [inputStyles, textStyles, mdiIconPickerStyles];

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has("_open")) this._dismiss.set(this._open);
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
  private _dismiss = new LightDismissController(this, () => this._close(), {
    escapeTarget: document,
    onEscape: (e) => e.stopPropagation(),
  });

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
    fireEvent(this, "change", { value: next });
    this._close();
  }

  private _clear(e: Event) {
    e.stopPropagation();
    this.value = "";
    fireEvent(this, "change", { value: "" });
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
          ${
            results.length === 0
              ? html`<div class="empty">
                  <wa-icon
                    library="mdi"
                    name="magnify"
                    style="font-size: 24px;"
                  ></wa-icon>
                  No icons match “${this._query}”
                </div>`
              : html`<div class="grid">
                  ${results.map(
                    (entry) => html`
                      <button
                        type="button"
                        class=${
                          entry.name === selectedName
                            ? "icon-cell icon-cell--selected"
                            : "icon-cell"
                        }
                        title=${`mdi:${entry.name}`}
                        @click=${() => this._select(entry.name)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path fill="currentColor" d=${entry.path}></path>
                        </svg>
                      </button>
                    `
                  )}
                </div>`
          }
        </div>
        <div class="footer">
          <span>
            ${
              results.length === 0
                ? "No matches"
                : results.length >= MAX_RESULTS
                  ? `${MAX_RESULTS}+ of ${this._catalog.length.toLocaleString()}`
                  : `${results.length} of ${this._catalog.length.toLocaleString()}`
            }
          </span>
          ${
            selectedName
              ? html`<span class="footer-name">mdi:${selectedName}</span>`
              : nothing
          }
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
        <span
          class=${name ? "trigger-label truncate" : "trigger-label placeholder truncate"}
        >
          ${name ? `mdi:${name}` : this.placeholder}
        </span>
        ${
          name && !this.disabled
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
            : nothing
        }
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
