import { EditorLayout, SecretsEditorLayout } from "../api/types/system.js";
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
  // Default to the split view if an unexpected value slips through (e.g. a
  // hand-edited prefs file), mirroring prefToSecretsLayout's defaulting.
  return PREF_TO_DEVICE[layout] ?? "both";
}

export function secretsLayoutToPref(layout: SecretsLayout): SecretsEditorLayout {
  return layout === "yaml" ? SecretsEditorLayout.YAML : SecretsEditorLayout.VISUAL;
}

export function prefToSecretsLayout(layout: SecretsEditorLayout): SecretsLayout {
  return layout === SecretsEditorLayout.YAML ? "yaml" : "form";
}
