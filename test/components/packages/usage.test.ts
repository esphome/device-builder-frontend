import { describe, expect, it, vi } from "vitest";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { APIError } from "../../../src/api/api-error.js";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import type {
  ESPHomeFileListDialog,
  FileListDialogContent,
} from "../../../src/components/packages/file-list-dialog.js";
import { deviceItems, fileItems } from "../../../src/components/packages/link-list.js";
import {
  fetchUsers,
  renameFile,
  showDependencies,
  showUsage,
} from "../../../src/components/packages/usage.js";

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

  it("doesn't claim nobody uses the file while devices are unchecked", async () => {
    const api = {
      getFileUsage: vi.fn().mockResolvedValue({ used_by: [], unknown: ["broken.yaml"] }),
    } as unknown as ESPHomeAPI;
    const { dialog, opened } = fakeDialog();

    await showUsage(api, localize, devices, dialog, "common/a.yaml");

    expect(opened[0].message).toBe("");
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

describe("renameFile / fetchUsers", () => {
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

  it("fetchUsers returns the users, or null after a toast", async () => {
    const ok = {
      getFileUsage: vi.fn().mockResolvedValue({ used_by: ["a.yaml"], unknown: [] }),
    } as unknown as ESPHomeAPI;
    expect(await fetchUsers(ok, localize, "common/a.yaml")).toEqual({
      used_by: ["a.yaml"],
      unknown: [],
    });

    const bad = {
      getFileUsage: vi.fn().mockRejectedValue(new APIError("internal_error", "x")),
    } as unknown as ESPHomeAPI;
    expect(await fetchUsers(bad, localize, "common/a.yaml")).toBeNull();
  });
});
