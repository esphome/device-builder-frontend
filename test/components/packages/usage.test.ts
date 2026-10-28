import { describe, expect, it, vi } from "vitest";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { APIError } from "../../../src/api/api-error.js";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import { deviceItems, fileItems } from "../../../src/components/packages/link-list.js";
import { renameFile } from "../../../src/components/packages/usage.js";

vi.mock("../../../src/util/notify.js", () => ({
  LONG_TOAST_DURATION_MS: 8000,
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
}));
const { notifyError, notifySuccess, notifyWarning } =
  await import("../../../src/util/notify.js");

const localize = (key: string, args?: Record<string, unknown>) =>
  args ? `${key} ${JSON.stringify(args)}` : key;

const devices = [
  makeConfiguredDevice({
    configuration: "kitchen.yaml",
    name: "kitchen",
    friendly_name: "Kitchen",
  }),
  makeConfiguredDevice({
    configuration: "bare.yaml",
    name: "bare.yaml",
    friendly_name: "",
  }),
];

describe("link-list items", () => {
  it("labels devices with their friendly name and links the device editor", () => {
    expect(deviceItems(["kitchen.yaml", "bare.yaml", "gone.yaml"], devices)).toEqual([
      { label: "Kitchen", detail: "kitchen.yaml", url: "/device/kitchen.yaml" },
      { label: "bare.yaml", detail: undefined, url: "/device/bare.yaml" },
      { label: "gone.yaml", detail: undefined, url: "/device/gone.yaml" },
    ]);
  });

  it("links top-level files to the device editor, the rest to the file editor, absolute paths nowhere", () => {
    expect(
      fileItems(["common/a.yaml", "kitchen.yaml", "/abs/x.yaml", "C:/abs/y.yaml"])
    ).toEqual([
      { label: "common/a.yaml", url: "/file/common/a.yaml" },
      { label: "kitchen.yaml", url: "/device/kitchen.yaml" },
      { label: "/abs/x.yaml", url: null },
      { label: "C:/abs/y.yaml", url: null },
    ]);
  });
});

describe("renameFile", () => {
  const detail = { path: "common/a.yaml", newPath: "shared/a.yaml" };

  it("reports rewritten files and warns about unresolved devices", async () => {
    const api = {
      renameFile: vi.fn().mockResolvedValue({
        path: "shared/a.yaml",
        rewritten: ["kitchen.yaml"],
        unresolved: ["garage.yaml"],
      }),
    } as unknown as ESPHomeAPI;

    expect(await renameFile(api, localize, detail)).toBe("shared/a.yaml");
    expect(api.renameFile).toHaveBeenCalledWith("common/a.yaml", "shared/a.yaml");
    expect(vi.mocked(notifySuccess).mock.lastCall?.[1]?.description).toBe(
      'packages.renamed_rewritten {"count":1,"files":"kitchen.yaml"}'
    );
    expect(vi.mocked(notifyWarning).mock.lastCall?.[0]).toBe(
      'packages.renamed_unresolved {"names":"garage.yaml"}'
    );
  });

  it("returns null and toasts on failure", async () => {
    vi.mocked(notifyWarning).mockClear();
    const api = {
      renameFile: vi.fn().mockRejectedValue(new APIError("already_exists", "taken")),
    } as unknown as ESPHomeAPI;

    expect(await renameFile(api, localize, detail)).toBeNull();
    expect(notifyError).toHaveBeenCalledWith("packages.rename_failed: taken");
    expect(notifyWarning).not.toHaveBeenCalled();
  });
});
