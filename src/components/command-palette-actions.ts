import type { ConfiguredDevice, YamlSearchHit } from "../api/types/devices.js";
import type { LanguageChoice, LocalizeFunc } from "../common/localize.js";
import { LANGUAGES, languageLabel } from "../common/localize.js";
import { navigate } from "../util/navigation.js";
import {
  forEachYamlMatch,
  yamlHitHref,
  yamlHitLabel,
} from "../util/yaml-search-helpers.js";

export interface CommandAction {
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

/** Inputs the static command list needs from the palette host. */
export interface CommandActionContext {
  t: LocalizeFunc;
  devices: ConfiguredDevice[];
  yamlDiffEnabled: boolean;
  setTheme: (theme: string) => void;
  setLanguage: (lang: LanguageChoice) => void;
  toggleDiffButton: () => void;
}

/** The default (non-YAML-mode) command list: navigation, devices,
 *  themes, languages, editor toggles. */
export function buildCommands(ctx: CommandActionContext): CommandAction[] {
  const { t } = ctx;

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
  const devices: CommandAction[] = ctx.devices.map((d) => ({
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
      run: () => ctx.setTheme("light"),
    },
    {
      id: "theme.dark",
      group: themeGroup,
      label: t("layout.theme_dark"),
      icon: "weather-night",
      keywords: ["dark", "theme"],
      run: () => ctx.setTheme("dark"),
    },
    {
      id: "theme.system",
      group: themeGroup,
      label: t("layout.theme_system"),
      icon: "theme-light-dark",
      keywords: ["system", "auto"],
      run: () => ctx.setTheme("system"),
    },
  ];

  const editor: CommandAction[] = [
    {
      id: "editor.yaml_diff_button",
      group: t("layout.editor"),
      label: ctx.yamlDiffEnabled
        ? t("command_palette.hide_yaml_diff_button")
        : t("command_palette.show_yaml_diff_button"),
      icon: "vector-difference",
      keywords: ["diff", "yaml", "compare"],
      run: () => ctx.toggleDiffButton(),
    },
  ];

  const languageGroup = t("command_palette.group_language");
  const languages: CommandAction[] = LANGUAGES.map((l) => ({
    id: `language.${l.value}`,
    group: languageGroup,
    label: languageLabel(l, t),
    flag: l.flag,
    keywords: ["language", "locale", l.value],
    run: () => ctx.setLanguage(l.value),
  }));

  return [...nav, ...devices, ...themes, ...languages, ...editor];
}

/**
 * Materialise the live YAML-content hits as ``CommandAction``s so
 * the existing render + keyboard-nav code handles them without a
 * parallel branch. Each match becomes its own row (one device with
 * three matches → three rows) so the user can pick the specific
 * line they want to land on. Click → navigate to
 * ``/device/<configuration>?line=<n>``; the editor's ``_readUrlLine``
 * already wires that param to scroll-to + the existing highlight
 * machinery.
 */
export function buildYamlHitActions(
  hits: YamlSearchHit[] | null,
  t: LocalizeFunc
): CommandAction[] {
  const groupName = t("command_palette.group_yaml_matches");
  return forEachYamlMatch(hits, (hit, match) => ({
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
