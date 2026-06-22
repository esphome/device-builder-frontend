import { consume } from "@lit/context";
import {
  mdiChip,
  mdiCodeBraces,
  mdiHome,
  mdiKeyVariant,
  mdiMagnify,
  mdiThemeLightDark,
  mdiTune,
  mdiUpdate,
  mdiWeatherNight,
  mdiWeatherSunny,
} from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { ConfiguredDevice } from "../api/types/devices.js";
import type { LanguageChoice, LocalizeFunc } from "../common/localize.js";
import {
  apiContext,
  devicesContext,
  expertModeContext,
  localizeContext,
} from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { yamlEmptyMessageKey } from "../util/yaml-search-helpers.js";
import type { CommandAction } from "./command-palette-actions.js";
import {
  OPEN_COMMAND_PALETTE_EVENT,
  buildCommands,
  buildYamlHitActions,
} from "./command-palette-actions.js";
import { commandPaletteStyles } from "./command-palette.styles.js";
import { YamlSearchController } from "./yaml-search-controller.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  chip: mdiChip,
  "code-braces": mdiCodeBraces,
  home: mdiHome,
  "key-variant": mdiKeyVariant,
  magnify: mdiMagnify,
  "theme-light-dark": mdiThemeLightDark,
  tune: mdiTune,
  update: mdiUpdate,
  "weather-night": mdiWeatherNight,
  "weather-sunny": mdiWeatherSunny,
});

/** Recursively close every open popover in `root` and its shadow trees. */
function closeAllOpenPopovers(root: Document | ShadowRoot) {
  for (const el of root.querySelectorAll<HTMLElement>("[popover]")) {
    if (el.matches(":popover-open")) el.hidePopover?.();
  }
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    if (el.shadowRoot) closeAllOpenPopovers(el.shadowRoot);
  }
}

@customElement("esphome-command-palette")
export class ESPHomeCommandPalette extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  @consume({ context: expertModeContext, subscribe: true })
  @state()
  private _expertMode = false;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @state() private _open = false;
  /* True from open() until the hide animation ends; gates content so a
     closed palette doesn't re-render the command list on device events. */
  @state() private _contentRendered = false;
  @state() private _query = "";
  @state() private _selectedId = "";

  /**
   * YAML-content search controller. Owns the hits / debounce
   * timer / sequence number / TrailingEdgeDispatcher in one
   * place so this class doesn't have to keep them in sync. The
   * palette only ever reads ``_yamlSearch.hits`` and calls
   * ``scheduleQuery`` / ``clear``.
   *
   * ``getApi`` is a callback so the ``@consume``-injected
   * ``_api`` is read at call time — Lit fills that field after
   * the initial property setup, so capturing it eagerly in the
   * constructor would freeze a ``null`` reference.
   */
  private _yamlSearch = new YamlSearchController(this, () => this._api);

  @query(".search-input")
  private _searchInput?: HTMLInputElement;

  static styles = [espHomeStyles, commandPaletteStyles];

  /* Cmd+K is always-on (it opens the palette), so it stays on a
     dedicated keydown listener. Esc is wa-dialog's job: its
     dismissible stack closes only the topmost open dialog. */
  private _onGlobalKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      this._toggle();
    }
  };

  /* The kebab menu's Search item fires this so a visible affordance opens
     the same palette as Cmd+K. */
  private _onOpenEvent = () => this.open();

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this._onGlobalKeyDown);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, this._onOpenEvent);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this._onGlobalKeyDown);
    window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, this._onOpenEvent);
  }

  open() {
    // Close any open wa-select / wa-dropdown popover so it doesn't
    // linger inert under the modal backdrop.
    closeAllOpenPopovers(document);
    this._open = true;
    this._contentRendered = true;
    this._query = "";
    this._selectedId = "";
    this._yamlSearch.clear();
    // Belt and braces with wa-dialog's own [autofocus] handling.
    requestAnimationFrame(() => this._searchInput?.focus());
  }

  close() {
    this._open = false;
    // wa-dialog hides via its close animation, not by disconnecting,
    // so a pending debounce timer / queued dispatcher input would
    // otherwise still flush a ``yaml/search`` after close.
    this._yamlSearch.clear();
  }

  private _toggle() {
    if (this._open) this.close();
    else this.open();
  }

  // Esc and light-dismiss close the wa-dialog on their own; sync state
  // on the initiating hide so a queued yaml/search can't flush during
  // the hide animation.
  private _onHide = (e: Event) => {
    if (e.target !== e.currentTarget) return;
    this.close();
  };

  // Drop the content once the hide animation ends; keep it when the
  // palette was reopened mid-animation.
  private _onAfterHide = (e: Event) => {
    if (e.target !== e.currentTarget) return;
    if (!this._open) this._contentRendered = false;
  };

  private _allCommands(): CommandAction[] {
    return buildCommands({
      t: this._localize,
      devices: this._devices,
      expertMode: this._expertMode,
      setTheme: (theme) => this._setTheme(theme),
      setLanguage: (lang) => this._setLanguage(lang),
      toggleExpertMode: () => this._toggleExpertMode(),
      openUpdateAll: () => this._openUpdateAll(),
    });
  }

  /**
   * YAML search is gated behind a leading slash (``/wifi``,
   * ``/i2c``, ...) so the default palette query stays a pure
   * client-side filter — typing "themes" or a device name
   * mustn't fire a backend round trip on every keystroke. The
   * slash trigger is mnemonic for "search content" and matches
   * VS Code's "type \\? to search" pattern; users who don't
   * know about it never pay the WS cost.
   */
  private static readonly _YAML_PREFIX = "/";

  /** True when the current query is in YAML-search mode. */
  private get _isYamlMode(): boolean {
    return (
      this._expertMode &&
      this._query.trimStart().startsWith(ESPHomeCommandPalette._YAML_PREFIX)
    );
  }

  /** The YAML query body — i.e. the input minus the leading ``/``. */
  private get _yamlQuery(): string {
    if (!this._isYamlMode) return "";
    return this._query
      .trimStart()
      .slice(ESPHomeCommandPalette._YAML_PREFIX.length)
      .trim();
  }

  private _filtered(): CommandAction[] {
    if (this._isYamlMode) {
      // YAML mode skips the command list entirely — the user
      // explicitly asked for content search, mixing themes /
      // language entries underneath would be noise.
      return this._yamlHitActions();
    }
    const q = this._query.trim().toLowerCase();
    const all = this._allCommands();
    if (!q) return all;
    return all.filter((cmd) => {
      const haystack = [cmd.label, cmd.group, ...(cmd.keywords ?? [])]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  private _yamlHitActions(): CommandAction[] {
    return buildYamlHitActions(this._yamlSearch.hits, this._localize);
  }

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has("_open") || changed.has("_query")) {
      const items = this._filtered();
      if (items.length && !items.find((i) => i.id === this._selectedId)) {
        this._selectedId = items[0].id;
      }
    }
  }

  /* wa-dialog shows via showModal(), so the palette lives in the top
     layer and stacks above an already-open dialog (Settings, Firmware
     Tasks, ...) instead of painting behind it. Raw wa-dialog on purpose:
     base-dialog's header / close-button / busy chrome isn't wanted here.
     The header is hidden via ::part(header) rather than without-header
     so ``label`` still gives the dialog its accessible name. */
  protected render() {
    return html`
      <wa-dialog
        label=${this._localize("command_palette.title")}
        light-dismiss
        ?open=${this._open}
        @wa-hide=${this._onHide}
        @wa-after-hide=${this._onAfterHide}
      >
        ${this._contentRendered ? this._renderContent() : nothing}
      </wa-dialog>
    `;
  }

  private _renderContent() {
    const items = this._filtered();
    const groups: { name: string; items: CommandAction[] }[] = [];
    let cursor = "";
    for (const item of items) {
      if (item.group !== cursor) {
        groups.push({ name: item.group, items: [] });
        cursor = item.group;
      }
      groups[groups.length - 1].items.push(item);
    }

    /* Visual mode-switch feedback: the leading-icon flips from
       the generic magnify to the "code braces" YAML icon as soon
       as the query starts with the YAML prefix. Combined with
       the always-on ``/ search YAML content`` hint in the footer
       below, this is what makes the otherwise-hidden mode
       discoverable from the UI rather than only via docs. */
    const inYamlMode = this._isYamlMode;
    const searchIcon = inYamlMode ? "code-braces" : "magnify";
    const placeholder = this._localize(
      this._expertMode
        ? "command_palette.placeholder"
        : "command_palette.placeholder_basic"
    );
    return html`
      <div class="search">
        <wa-icon library="mdi" name=${searchIcon}></wa-icon>
        <input
          class="search-input"
          type="text"
          .value=${this._query}
          placeholder=${placeholder}
          aria-label=${placeholder}
          @input=${this._onQueryInput}
          @keydown=${this._onInputKeyDown}
          autocomplete="off"
          spellcheck="false"
          autofocus
        />
        <!--
            Mode toggle: explicit switch-to-YAML / switch-to-commands
            button next to the input. Same effect as typing or removing
            the leading slash but discoverable for users who haven't
            seen the prefix shortcut. The tooltip names the destination
            mode so the affordance reads as an action rather than a
            status badge.
          -->
        ${this._expertMode
          ? html`<button
              class="mode-toggle ${inYamlMode ? "mode-toggle--yaml" : ""}"
              type="button"
              title=${this._localize(
                inYamlMode
                  ? "command_palette.switch_to_commands"
                  : "command_palette.switch_to_yaml"
              )}
              aria-label=${this._localize(
                inYamlMode
                  ? "command_palette.switch_to_commands"
                  : "command_palette.switch_to_yaml"
              )}
              aria-pressed=${inYamlMode ? "true" : "false"}
              @click=${this._onToggleMode}
            >
              <wa-icon
                library="mdi"
                name=${inYamlMode ? "magnify" : "code-braces"}
              ></wa-icon>
            </button>`
          : nothing}
      </div>
      <div class="list" role="listbox">
        ${items.length === 0
          ? html`<div class="empty">${this._renderEmptyMessage()}</div>`
          : groups.map(
              (g) => html`
                <div class="group">
                  <div class="group-heading">${g.name}</div>
                  ${g.items.map((item) => this._renderItem(item))}
                </div>
              `
            )}
      </div>
      <div class="footer">
        <span
          ><kbd>↑</kbd><kbd>↓</kbd> ${this._localize(
            "command_palette.navigate_hint"
          )}</span
        >
        <span><kbd>↵</kbd> ${this._localize("command_palette.select_hint")}</span>
        <span><kbd>esc</kbd> ${this._localize("command_palette.close_hint")}</span>
        ${this._expertMode
          ? html`<span class="yaml-hint">
              <kbd>/</kbd> ${this._localize("command_palette.yaml_search_hint")}
            </span>`
          : nothing}
      </div>
    `;
  }

  /**
   * Pick the right empty-state copy. Three cases:
   *
   * 1. YAML mode + non-empty query + ``_yamlSearch.hits === null`` →
   *    "Searching…" — either the debounce hasn't fired yet or
   *    a request is in flight, no results to show but more are
   *    coming.
   * 2. YAML mode + non-empty query + ``_yamlSearch.hits === []`` →
   *    "No matches" — fetched, nothing matched the query.
   * 3. Otherwise (command mode with a non-matching query, or
   *    YAML mode with an empty body) → fall back to the generic
   *    "No results found" copy.
   */
  private _renderEmptyMessage() {
    if (this._isYamlMode && this._yamlQuery) {
      const key = yamlEmptyMessageKey(this._yamlSearch.hits);
      if (key) return this._localize(key);
    }
    return this._localize("command_palette.no_results");
  }

  private _renderItem(item: CommandAction) {
    const selected = item.id === this._selectedId;
    return html`
      <div
        class="item ${selected ? "item--selected" : ""}"
        role="option"
        aria-selected=${selected}
        @click=${() => this._run(item)}
        @mouseenter=${() => (this._selectedId = item.id)}
      >
        ${item.flag
          ? html`<span class="item-flag" aria-hidden="true">${item.flag}</span>`
          : item.icon
            ? html`<wa-icon library="mdi" name=${item.icon}></wa-icon>`
            : nothing}
        <span class="item-label">${item.label}</span>
      </div>
    `;
  }

  private _onQueryInput(e: Event) {
    this._query = (e.target as HTMLInputElement).value;
    this._syncYamlSearch();
  }

  /**
   * Flip the leading ``/`` prefix on or off, preserving the rest
   * of the query so a user mid-typing can switch modes without
   * losing their text. Same observable effect as manually typing
   * or deleting the slash, but exposed as a clickable affordance
   * for users who haven't picked up the prefix shortcut.
   *
   * After toggling we refocus the input so keyboard nav (↑↓↵) on
   * the freshly-filtered list still works without a tab back.
   */
  private _onToggleMode = () => {
    // Only strip the *single* leading prefix slash (plus any
    // surrounding whitespace), not every leading slash. A user
    // searching for ``/dev/ttyUSB0`` would type ``//dev/ttyUSB0``
    // — the first slash is the mode prefix, the second begins
    // the body. Stripping ``/+`` would mangle the body into
    // ``dev/ttyUSB0`` on toggle.
    const stripped = this._query.replace(/^\s*\/\s*/, "");
    this._query = this._isYamlMode
      ? stripped
      : `${ESPHomeCommandPalette._YAML_PREFIX}${stripped}`;
    this._syncYamlSearch();
    requestAnimationFrame(() => this._searchInput?.focus());
  };

  /**
   * Bridge the current query to the ``YamlSearchController``.
   *
   * Called from every place ``_query`` mutates: typed input and
   * the mode-toggle button. The controller's ``sync`` owns the
   * out-of-mode + empty-body collapse-to-``clear`` rules.
   */
  private _syncYamlSearch() {
    this._yamlSearch.sync(this._isYamlMode, this._yamlQuery);
  }

  private _onInputKeyDown(e: KeyboardEvent) {
    const items = this._filtered();
    if (!items.length) return;
    const idx = Math.max(
      0,
      items.findIndex((c) => c.id === this._selectedId)
    );

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = idx >= items.length - 1 ? 0 : idx + 1;
      this._selectedId = items[next].id;
      this._scrollSelectedIntoView();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = idx <= 0 ? items.length - 1 : idx - 1;
      this._selectedId = items[prev].id;
      this._scrollSelectedIntoView();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = items[idx];
      if (target) this._run(target);
    }
  }

  private _scrollSelectedIntoView() {
    requestAnimationFrame(() => {
      const el = this.shadowRoot?.querySelector(".item--selected");
      el?.scrollIntoView({ block: "nearest" });
    });
  }

  private _run(cmd: CommandAction) {
    this.close();
    cmd.run();
  }

  private _setTheme(theme: string) {
    this.dispatchEvent(
      new CustomEvent("set-theme", {
        detail: theme,
        bubbles: true,
        composed: true,
      })
    );
  }

  private _setLanguage(lang: LanguageChoice) {
    this.dispatchEvent(
      new CustomEvent("set-language", {
        detail: lang,
        bubbles: true,
        composed: true,
      })
    );
  }

  private _toggleExpertMode() {
    this.dispatchEvent(
      new CustomEvent("set-expert-mode", {
        detail: !this._expertMode,
        bubbles: true,
        composed: true,
      })
    );
  }

  private _openUpdateAll() {
    this.dispatchEvent(
      new CustomEvent("open-update-all", { bubbles: true, composed: true })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-command-palette": ESPHomeCommandPalette;
  }
}
