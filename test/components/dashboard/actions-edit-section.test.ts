/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/util/navigation.js", () => ({ navigate: vi.fn() }));
vi.mock("../../../src/util/download-text.js", () => ({ downloadBlob: vi.fn() }));
vi.mock("../../../src/util/notify.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/util/notify.js")>()),
  notifyError: vi.fn(),
}));

import { identityLocalize } from "../../_dom.js";
import type { ESPHomeAPI } from "../../../src/api/esphome-api.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import type { LocalizeFunc } from "../../../src/common/localize.js";
import {
  downloadYaml,
  editDevice,
  editDeviceSection,
} from "../../../src/components/dashboard/actions.js";
import { downloadBlob } from "../../../src/util/download-text.js";
import { navigate } from "../../../src/util/navigation.js";

describe("editDeviceSection", () => {
  it("deep-links to the editor with the section query param", () => {
    editDeviceSection({ configuration: "kitchen.yaml" } as ConfiguredDevice, "api");
    expect(navigate).toHaveBeenCalledWith("/device/kitchen.yaml?section=api");
  });

  it("adds the one-shot reveal intent only when opted in", () => {
    editDeviceSection({ configuration: "kitchen.yaml" } as ConfiguredDevice, "api", {
      reveal: true,
    });
    expect(navigate).toHaveBeenCalledWith("/device/kitchen.yaml?section=api&reveal=1");
  });

  it("URI-encodes the configuration and the section", () => {
    editDeviceSection({ configuration: "foo (1).yaml" } as ConfiguredDevice, "api");
    expect(navigate).toHaveBeenCalledWith("/device/foo%20(1).yaml?section=api");
  });
});

describe("editDevice", () => {
  it("opens a nested device with literal slashes and no query", () => {
    editDevice({ configuration: "devices/lights/desk lamp.yaml" } as ConfiguredDevice);
    expect(navigate).toHaveBeenCalledWith("/device/devices/lights/desk%20lamp.yaml");
  });
});

describe("downloadYaml", () => {
  const api = (yaml: string) =>
    ({ getConfig: vi.fn().mockResolvedValue(yaml) }) as unknown as ESPHomeAPI;
  const localize = identityLocalize as LocalizeFunc;

  it("saves a nested device under its file name, without the folder", async () => {
    const getConfig = api("esphome: {}\n");
    await downloadYaml(
      { configuration: "devices/lights/desk.yaml", name: "desk" } as ConfiguredDevice,
      getConfig,
      localize
    );

    expect(getConfig.getConfig).toHaveBeenCalledWith("devices/lights/desk.yaml");
    expect(downloadBlob).toHaveBeenCalledWith("esphome: {}\n", "desk.yaml", "text/yaml");
  });

  it("appends .yaml to a file name that lacks it", async () => {
    await downloadYaml(
      { configuration: "devices/lights/desk", name: "desk" } as ConfiguredDevice,
      api("x"),
      localize
    );

    expect(downloadBlob).toHaveBeenCalledWith("x", "desk.yaml", "text/yaml");
  });
});
