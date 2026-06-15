import { describe, expect, it } from "vitest";
import { EditorLayout, SecretsEditorLayout } from "../../src/api/types/system.js";
import type { DeviceLayoutMode } from "../../src/components/device/device-editor.js";
import {
  deviceLayoutToPref,
  prefToDeviceLayout,
  prefToSecretsLayout,
  secretsLayoutToPref,
  type SecretsLayout,
} from "../../src/util/editor-layout.js";

describe("device layout mapping", () => {
  it("round-trips every device layout mode through the pref enum", () => {
    const modes: DeviceLayoutMode[] = ["left", "both", "right"];
    for (const mode of modes) {
      expect(prefToDeviceLayout(deviceLayoutToPref(mode))).toBe(mode);
    }
  });

  it("maps panes to the shared enum", () => {
    expect(deviceLayoutToPref("left")).toBe(EditorLayout.VISUAL);
    expect(deviceLayoutToPref("right")).toBe(EditorLayout.YAML);
    expect(deviceLayoutToPref("both")).toBe(EditorLayout.BOTH);
  });

  it("defaults an unexpected pref value to the split view", () => {
    expect(prefToDeviceLayout("bogus" as EditorLayout)).toBe("both");
  });
});

describe("secrets layout mapping", () => {
  it("round-trips the two secrets layouts through the pref enum", () => {
    const layouts: SecretsLayout[] = ["form", "yaml"];
    for (const layout of layouts) {
      expect(prefToSecretsLayout(secretsLayoutToPref(layout))).toBe(layout);
    }
  });

  it("maps onto the two-value secrets enum", () => {
    expect(secretsLayoutToPref("form")).toBe(SecretsEditorLayout.VISUAL);
    expect(secretsLayoutToPref("yaml")).toBe(SecretsEditorLayout.YAML);
    expect(prefToSecretsLayout(SecretsEditorLayout.VISUAL)).toBe("form");
    expect(prefToSecretsLayout(SecretsEditorLayout.YAML)).toBe("yaml");
  });
});
