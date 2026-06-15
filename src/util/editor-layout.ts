import { EditorLayout } from "../api/types/system.js";
import type { DeviceLayoutMode } from "../components/device/device-editor.js";

// The secrets editor only has two panes, so its layout never includes BOTH.
export type SecretsLayout = "form" | "yaml";

const DEVICE_TO_PREF: Record<DeviceLayoutMode, EditorLayout> = {
  left: EditorLayout.VISUAL,
  right: EditorLayout.YAML,
  both: EditorLayout.BOTH,
};

const PREF_TO_DEVICE: Record<EditorLayout, DeviceLayoutMode> = {
  [EditorLayout.VISUAL]: "left",
  [EditorLayout.YAML]: "right",
  [EditorLayout.BOTH]: "both",
};

export function deviceLayoutToPref(mode: DeviceLayoutMode): EditorLayout {
  return DEVICE_TO_PREF[mode];
}

export function prefToDeviceLayout(layout: EditorLayout): DeviceLayoutMode {
  return PREF_TO_DEVICE[layout];
}

export function secretsLayoutToPref(layout: SecretsLayout): EditorLayout {
  return layout === "yaml" ? EditorLayout.YAML : EditorLayout.VISUAL;
}

export function prefToSecretsLayout(layout: EditorLayout): SecretsLayout {
  // Secrets has no split pane; a stray BOTH falls back to the YAML pane.
  return layout === EditorLayout.VISUAL ? "form" : "yaml";
}
