import type { SupportedLocale } from "../../common/localize.js";

export type LanguageChoice = SupportedLocale | "system";

export type Section =
  | "appearance"
  | "language"
  | "editor"
  | "build_server"
  | "pairing_requests"
  | "build_offload";

export interface SectionDef {
  id: Section;
  icon: string;
  labelKey: string;
  group?: "experimental";
}

export const SECTIONS: SectionDef[] = [
  { id: "appearance", icon: "palette-outline", labelKey: "settings.appearance" },
  { id: "language", icon: "translate", labelKey: "settings.language" },
  { id: "editor", icon: "vector-difference", labelKey: "layout.editor" },
  {
    id: "build_server",
    icon: "server-network",
    labelKey: "settings.build_server",
    group: "experimental",
  },
  {
    id: "pairing_requests",
    icon: "handshake-outline",
    labelKey: "settings.pairing_requests",
    group: "experimental",
  },
  {
    id: "build_offload",
    icon: "send-outline",
    labelKey: "settings.build_offload",
    group: "experimental",
  },
];

export const LANGUAGES: { value: LanguageChoice; labelKey: string }[] = [
  { value: "system", labelKey: "settings.language_system" },
  { value: "en", labelKey: "settings.language_en" },
  { value: "fr", labelKey: "settings.language_fr" },
  { value: "nl", labelKey: "settings.language_nl" },
];
