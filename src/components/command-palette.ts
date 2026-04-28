import { consume } from "@lit/context";
import {
  mdiChip,
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
import type { ConfiguredDevice } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import {
  devicesContext,
  localizeContext,
  yamlDiffButtonContext,
} from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { navigate } from "../util/navigation.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { commandPaletteStyles } from "./command-palette.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  chip: mdiChip,
  home: mdiHome,
  "key-variant": mdiKeyVariant,
  magnify: mdiMagnify,
  "theme-light-dark": mdiThemeLightDark,
  "vector-difference": mdiVectorDifference,
  "weather-night": mdiWeatherNight,
  "weather-sunny": mdiWeatherSunny,
});

interface CommandAction {
  id: string;
  group: string;
  label: string;
  icon?: string;
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

  @state() private _open = false;
  @state() private _query = "";
  @state() private _selectedId = "";

  @query(".search-input")
  private _searchInput?: HTMLInputElement;

  static styles = [espHomeStyles, commandPaletteStyles];

  private _onGlobalKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      this._toggle();
      return;
    }
    if (this._open && e.key === "Escape") {
      e.preventDefault();
      this.close();
    }
  };

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this._onGlobalKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this._onGlobalKeyDown);
  }

  open() {
    this._open = true;
    this._query = "";
    this._selectedId = "";
    requestAnimationFrame(() => this._searchInput?.focus());
  }

  close() {
    this._open = false;
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
        id: "editor.diff_button",
        group: t("layout.editor"),
        label: this._yamlDiffEnabled
          ? t("command_palette.disable_diff_button")
          : t("command_palette.enable_diff_button"),
        icon: "vector-difference",
        keywords: ["diff", "yaml", "compare"],
        run: () => this._toggleDiffButton(),
      },
    ];

    return [...nav, ...devices, ...themes, ...editor];
  }

  private _filtered(): CommandAction[] {
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

    return html`
      <div class="backdrop" @click=${this.close}></div>
      <div class="dialog" role="dialog" aria-modal="true">
        <div class="search">
          <wa-icon library="mdi" name="magnify"></wa-icon>
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
        </div>
        <div class="list" role="listbox">
          ${items.length === 0
            ? html`<div class="empty">${this._localize("command_palette.no_results")}</div>`
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
          <span><kbd>↑</kbd><kbd>↓</kbd> ${this._localize("command_palette.navigate_hint")}</span>
          <span><kbd>↵</kbd> ${this._localize("command_palette.select_hint")}</span>
          <span><kbd>esc</kbd> ${this._localize("command_palette.close_hint")}</span>
        </div>
      </div>
    `;
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
        ${item.icon
          ? html`<wa-icon library="mdi" name=${item.icon}></wa-icon>`
          : nothing}
        <span class="item-label">${item.label}</span>
      </div>
    `;
  }

  private _onQueryInput(e: Event) {
    this._query = (e.target as HTMLInputElement).value;
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
