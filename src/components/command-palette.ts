import { consume } from "@lit/context";
import {
  mdiChip,
  mdiCodeBraces,
  mdiHome,
  mdiKeyVariant,
  mdiMagnify,
  mdiThemeLightDark,
  mdiVectorDifference,
  mdiWeatherNight,
  mdiWeatherSunny,
} from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { ConfiguredDevice } from "../api/types.js";
import type { LanguageChoice, LocalizeFunc } from "../common/localize.js";
import { LANGUAGES } from "../common/localize.js";
import {
  apiContext,
  devicesContext,
  localizeContext,
  yamlDiffButtonContext,
} from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { EscapeController } from "../util/escape-controller.js";
import { navigate } from "../util/navigation.js";
import { registerMdiIcons } from "../util/register-icons.js";
import {
  forEachYamlMatch,
  yamlEmptyMessageKey,
  yamlHitHref,
  yamlHitLabel,
} from "../util/yaml-search-helpers.js";
import { commandPaletteStyles } from "./command-palette.styles.js";
import { YamlSearchController } from "./yaml-search-controller.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  chip: mdiChip,
  "code-braces": mdiCodeBraces,
  home: mdiHome,
  "key-variant": mdiKeyVariant,
  magnify: mdiMagnify,
  "theme-light-dark": mdiThemeLightDark,
  "vector-difference": mdiVectorDifference,
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

interface CommandAction {
  id: string;
  group: string;
  label: string;
  /** MDI icon name registered via ``registerMdiIcons``; rendered
   *  through ``<wa-icon library="mdi">``. Mutually exclusive with
   *  ``flag`` — when both are set, ``flag`` wins. */
  icon?: string;
  /** Emoji prefix shown in place of the MDI icon column. Used for
   *  language entries so the picker reads as flags-not-icons. */
  flag?: string;
  keywords?: string[];
  run: () => void;
}

@customElement("esphome-command-palette")
export class ESPHomeCommandPalette extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  @consume({ context: yamlDiffButtonContext, subscribe: true })
  @state()
  private _yamlDiffEnabled = false;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @state() private _open = false;
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

  private _onGlobalKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      this._toggle();
    }
  };

  /* Cmd+K is always-on (it opens the palette), so it stays on a
     dedicated keydown listener. Esc only matters while the palette is
     open and is handled by EscapeController, which attaches/detaches
     in lockstep with ``_open``. */
  private _escape = new EscapeController(this, (e) => {
    e.preventDefault();
    this.close();
  });

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this._onGlobalKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this._onGlobalKeyDown);
  }

  open() {
    // Any open wa-select / wa-dropdown sits in the browser top layer
    // via the popover API and would float above us regardless of
    // z-index. Walk the document + every shadow root and close them
    // before showing the palette.
    closeAllOpenPopovers(document);
    this._open = true;
    this._query = "";
    this._selectedId = "";
    this._yamlSearch.clear();
    requestAnimationFrame(() => this._searchInput?.focus());
  }

  close() {
    this._open = false;
    // The palette is hidden by ``render() → nothing``, not by
    // disconnecting from the DOM, so ``hostDisconnected`` doesn't
    // fire and a pending debounce timer / queued dispatcher input
    // would otherwise still flush a ``yaml/search`` after close.
    this._yamlSearch.clear();
  }

  private _toggle() {
    if (this._open) this.close();
    else this.open();
  }

  private _allCommands(): CommandAction[] {
    const t = this._localize;

    const nav: CommandAction[] = [
      {
        id: "nav.home",
        group: t("command_palette.group_navigation"),
        label: t("command_palette.go_dashboard"),
        icon: "home",
        keywords: ["dashboard", "devices"],
        run: () => navigate("/"),
      },
      {
        id: "nav.secrets",
        group: t("command_palette.group_navigation"),
        label: t("layout.secrets"),
        icon: "key-variant",
        keywords: ["password", "wifi"],
        run: () => navigate("/secrets"),
      },
    ];

    const deviceGroup = t("command_palette.group_devices");
    const devices: CommandAction[] = this._devices.map((d) => ({
      id: `device.${d.configuration}`,
      group: deviceGroup,
      label: d.friendly_name || d.name || d.configuration,
      icon: "chip",
      keywords: [d.configuration, d.name],
      run: () => navigate(`/device/${d.configuration}`),
    }));

    const themeGroup = t("layout.theme");
    const themes: CommandAction[] = [
      {
        id: "theme.light",
        group: themeGroup,
        label: t("layout.theme_light"),
        icon: "weather-sunny",
        keywords: ["light", "theme"],
        run: () => this._setTheme("light"),
      },
      {
        id: "theme.dark",
        group: themeGroup,
        label: t("layout.theme_dark"),
        icon: "weather-night",
        keywords: ["dark", "theme"],
        run: () => this._setTheme("dark"),
      },
      {
        id: "theme.system",
        group: themeGroup,
        label: t("layout.theme_system"),
        icon: "theme-light-dark",
        keywords: ["system", "auto"],
        run: () => this._setTheme("system"),
      },
    ];

    const editor: CommandAction[] = [
      {
        id: "editor.yaml_diff_button",
        group: t("layout.editor"),
        label: this._yamlDiffEnabled
          ? t("command_palette.hide_yaml_diff_button")
          : t("command_palette.show_yaml_diff_button"),
        icon: "vector-difference",
        keywords: ["diff", "yaml", "compare"],
        run: () => this._toggleDiffButton(),
      },
    ];

    const languageGroup = t("command_palette.group_language");
    const languages: CommandAction[] = LANGUAGES.map((l) => ({
      id: `language.${l.value}`,
      group: languageGroup,
      label: t(l.labelKey),
      flag: l.flag,
      keywords: ["language", "locale", l.value],
      run: () => this._setLanguage(l.value),
    }));

    return [...nav, ...devices, ...themes, ...languages, ...editor];
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
    return this._query.trimStart().startsWith(ESPHomeCommandPalette._YAML_PREFIX);
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

  /**
   * Materialise the live YAML-content hits as ``CommandAction``s
   * so the existing render + keyboard-nav code handles them
   * without a parallel branch. Each match becomes its own row
   * (one device with three matches → three rows) so the user can
   * pick the specific line they want to land on. Click → navigate
   * to ``/device/<configuration>?line=<n>``; the editor's
   * ``_readUrlLine`` already wires that param to scroll-to + the
   * existing highlight machinery.
   */
  private _yamlHitActions(): CommandAction[] {
    const groupName = this._localize("command_palette.group_yaml_matches");
    return forEachYamlMatch(this._yamlSearch.hits, (hit, match) => ({
      id: `yaml.${hit.configuration}:${match.line_number}`,
      group: groupName,
      label: yamlHitLabel(hit, match),
      icon: "code-braces",
      // No ``keywords`` — YAML mode bypasses ``_filtered()``'s
      // keyword search entirely (the backend already did the
      // matching) so an unused keywords array would just retain
      // raw YAML line text — including potentially-sensitive
      // values — in memory for nothing.
      run: () => navigate(yamlHitHref(hit, match)),
    }));
  }

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has("_open")) this._escape.set(this._open);
  }

  protected updated(changed: Map<string, unknown>) {
    if (changed.has("_open") || changed.has("_query")) {
      const items = this._filtered();
      if (items.length && !items.find((i) => i.id === this._selectedId)) {
        this._selectedId = items[0].id;
      }
    }
  }

  protected render() {
    if (!this._open) return nothing;

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
    return html`
      <div class="backdrop" @click=${this.close}></div>
      <div class="dialog" role="dialog" aria-modal="true">
        <div class="search">
          <wa-icon library="mdi" name=${searchIcon}></wa-icon>
          <input
            class="search-input"
            type="text"
            .value=${this._query}
            placeholder=${this._localize("command_palette.placeholder")}
            @input=${this._onQueryInput}
            @keydown=${this._onInputKeyDown}
            autocomplete="off"
            spellcheck="false"
          />
          <!--
            Mode toggle: explicit switch-to-YAML / switch-to-commands
            button next to the input. Same effect as typing or removing
            the leading slash but discoverable for users who haven't
            seen the prefix shortcut. The tooltip names the destination
            mode so the affordance reads as an action rather than a
            status badge.
          -->
          <button
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
          </button>
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
          <span class="yaml-hint">
            <kbd>/</kbd> ${this._localize("command_palette.yaml_search_hint")}
          </span>
        </div>
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

  private _toggleDiffButton() {
    this.dispatchEvent(
      new CustomEvent("set-yaml-diff-button", {
        detail: !this._yamlDiffEnabled,
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-command-palette": ESPHomeCommandPalette;
  }
}
