import { describe, expect, it, vi } from "vitest";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { APIError } from "../../../src/api/api-error.js";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import type {
  ESPHomeFileListDialog,
  FileListDialogContent,
} from "../../../src/components/packages/file-list-dialog.js";
import { deviceItems, fileItems } from "../../../src/components/packages/link-list.js";
import { showDependencies, showUsage } from "../../../src/components/packages/usage.js";

vi.mock("../../../src/util/notify.js", () => ({ notifyError: vi.fn() }));
const { notifyError } = await import("../../../src/util/notify.js");

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

function fakeDialog(): {
  dialog: ESPHomeFileListDialog;
  opened: FileListDialogContent[];
} {
  const opened: FileListDialogContent[] = [];
  const dialog = {
    open: (c: FileListDialogContent) => opened.push(c),
  } as unknown as ESPHomeFileListDialog;
  return { dialog, opened };
}

describe("link-list items", () => {
  it("labels devices with their friendly name and links the device editor", () => {
    expect(deviceItems(["kitchen.yaml", "bare.yaml", "gone.yaml"], devices)).toEqual([
      { label: "Kitchen", detail: "kitchen.yaml", url: "/device/kitchen.yaml" },
      { label: "bare.yaml", detail: undefined, url: "/device/bare.yaml" },
      { label: "gone.yaml", detail: undefined, url: "/device/gone.yaml" },
    ]);
  });

  it("links files to the right editor and leaves outside paths unlinked", () => {
    expect(fileItems(["common/a.yaml", "kitchen.yaml", "/abs/x.yaml"], devices)).toEqual([
      { label: "common/a.yaml", url: "/file/common/a.yaml" },
      { label: "kitchen.yaml", url: "/device/kitchen.yaml" },
      { label: "/abs/x.yaml", url: null },
    ]);
  });
});

describe("showUsage / showDependencies", () => {
  it("lists the using devices and notes unknown ones", async () => {
    const api = {
      getFileUsage: vi
        .fn()
        .mockResolvedValue({ used_by: ["kitchen.yaml"], unknown: ["broken.yaml"] }),
    } as unknown as ESPHomeAPI;
    const { dialog, opened } = fakeDialog();

    await showUsage(api, localize, devices, dialog, "common/a.yaml");

    expect(api.getFileUsage).toHaveBeenCalledWith("common/a.yaml");
    expect(opened).toHaveLength(1);
    expect(opened[0].message).toBe('packages.usage_message {"count":1}');
    expect(opened[0].items.map((i) => i.label)).toEqual(["Kitchen"]);
    expect(opened[0].note).toBe('packages.usage_unknown {"names":"broken.yaml"}');
  });

  it("toasts with the backend detail when the lookup fails", async () => {
    const api = {
      getFileUsage: vi
        .fn()
        .mockRejectedValue(new APIError("invalid_args", "invalid file path")),
    } as unknown as ESPHomeAPI;
    const { dialog, opened } = fakeDialog();

    await showUsage(api, localize, devices, dialog, "x.txt");

    expect(opened).toEqual([]);
    expect(notifyError).toHaveBeenCalledWith("packages.usage_failed: invalid file path");
  });

  it("flags an incomplete dependency list", async () => {
    const api = {
      getDeviceDependencies: vi.fn().mockResolvedValue({ files: [], complete: false }),
    } as unknown as ESPHomeAPI;
    const { dialog, opened } = fakeDialog();

    await showDependencies(api, localize, devices, dialog, "kitchen.yaml");

    expect(opened[0].message).toBe('packages.dependencies_none {"count":0}');
    expect(opened[0].note).toBe("packages.dependencies_incomplete");
  });
});
