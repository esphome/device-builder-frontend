/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/util/navigation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/util/navigation.js")>()),
  navigate: vi.fn().mockResolvedValue(true),
}));

import { makeConfiguredDevice } from "../_make-configured-device.js";
import { ESPHomeYamlEditor } from "../../src/components/yaml-editor.js";
import { navigate } from "../../src/util/navigation.js";

function editorWithDevices(): { open(path: string): void } {
  const el = new ESPHomeYamlEditor();
  Object.assign(el, {
    _devices: [makeConfiguredDevice({ configuration: "_shared.yaml" })],
  });
  return { open: (el as unknown as { _openInclude(p: string): void })._openInclude };
}

describe("yaml-editor include link target", () => {
  it("opens a package in the file editor", () => {
    editorWithDevices().open("common/base.yaml");
    expect(navigate).toHaveBeenLastCalledWith("/file/common/base.yaml");
  });

  it("opens a device YAML in the device editor", () => {
    editorWithDevices().open("_shared.yaml");
    expect(navigate).toHaveBeenLastCalledWith("/device/_shared.yaml");
  });
});
