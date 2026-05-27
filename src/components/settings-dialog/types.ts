export type Section =
  | "appearance"
  | "language"
  | "editor"
  | "build_server"
  | "pairing_requests"
  | "build_offload";

export interface SectionDef {
  id: Section;
  /** MDI icon name used when this nav item is inactive. Prefer the
   *  outline variant so the filled `iconActive` reads as a clear
   *  "this is the active section" state, mirroring the fake-bold
   *  text-shadow already applied to the active label. */
  icon: string;
  /** MDI icon name used when this nav item is the active section.
   *  Falls back to `icon` if omitted (for icons like `translate`
   *  and `vector-difference` that have no outline/filled pair in
   *  MDI). */
  iconActive?: string;
  labelKey: string;
  group?: "experimental";
}

export const SECTIONS: SectionDef[] = [
  {
    id: "appearance",
    icon: "palette-outline",
    iconActive: "palette",
    labelKey: "settings.appearance",
  },
  { id: "language", icon: "translate", labelKey: "settings.language" },
  { id: "editor", icon: "vector-difference", labelKey: "layout.editor" },
  {
    id: "build_server",
    icon: "server-network-outline",
    iconActive: "server-network",
    labelKey: "settings.build_server",
    group: "experimental",
  },
  {
    id: "pairing_requests",
    icon: "handshake-outline",
    iconActive: "handshake",
    labelKey: "settings.pairing_requests",
    group: "experimental",
  },
  {
    id: "build_offload",
    icon: "send-outline",
    iconActive: "send",
    labelKey: "settings.build_offload",
    group: "experimental",
  },
];
