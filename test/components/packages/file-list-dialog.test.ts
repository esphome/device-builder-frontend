/** @vitest-environment happy-dom */
import "../../_mock-webawesome.js";

import { describe, expect, it, vi } from "vitest";
import { argsLocalize, baseDialogSettled, dialogOpen } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { APIError } from "../../../src/api/api-error.js";
import {
  ESPHomeFileListDialog,
  type FileListDialogContent,
} from "../../../src/components/packages/file-list-dialog.js";

vi.mock("../../../src/util/notify.js", () => ({ notifyError: vi.fn() }));
const { notifyError } = await import("../../../src/util/notify.js");

async function mount(api: object): Promise<{
  el: ESPHomeFileListDialog;
  content: () => FileListDialogContent;
}> {
  const el = new ESPHomeFileListDialog();
  Object.assign(el, {
    _api: api,
    _localize: argsLocalize,
    _devices: [
      makeConfiguredDevice({ configuration: "kitchen.yaml", friendly_name: "Kitchen" }),
    ],
  });
  document.body.appendChild(el);
  await baseDialogSettled(el);
  const content = () => (el as unknown as { _content: FileListDialogContent })._content;
  return { el, content };
}

describe("file-list-dialog showUsage", () => {
  it("lists the using devices by name and notes unchecked ones", async () => {
    const getFileUsage = vi.fn().mockResolvedValue({
      used_by: ["kitchen.yaml"],
      unknown: ["broken.yaml"],
      referenced_by: ["kitchen.yaml", "broken.yaml"],
      rewritable: ["kitchen.yaml", "broken.yaml"],
    });
    const { el, content } = await mount({ getFileUsage });

    await el.showUsage("common/a.yaml");

    expect(getFileUsage).toHaveBeenCalledWith("common/a.yaml");
    expect(dialogOpen(el)).toBe(true);
    expect(content().message).toBe("packages.usage_message | 1");
    expect(content().items.map((i) => i.label)).toEqual(["Kitchen"]);
    expect(content().note).toBe("packages.usage_unknown | broken.yaml");
    // direct includers already listed as devices aren't repeated
    expect(content().more).toBeUndefined();
  });

  it.each([
    ["a package", "bridge/plug.yaml", "/file/bridge/plug.yaml"],
    ["an archived device", "archive/old.yaml", null],
    ["a device the scanner hasn't loaded", "new-device.yaml", "/device/new-device.yaml"],
  ])("lists %s that includes the file", async (_, path, url) => {
    const { el, content } = await mount({
      getFileUsage: vi.fn().mockResolvedValue({
        used_by: [],
        unknown: [],
        referenced_by: [path],
        rewritable: [path],
      }),
    });

    await el.showUsage("common/a.yaml");

    expect(content().message).toBe("");
    expect(content().items).toEqual([]);
    expect(content().more).toEqual({
      message: "packages.usage_other_files | 1",
      items: [{ label: path, url }],
    });
  });

  it("says nobody uses the file only when nothing includes it", async () => {
    const { el, content } = await mount({
      getFileUsage: vi.fn().mockResolvedValue({
        used_by: [],
        unknown: [],
        referenced_by: [],
        rewritable: [],
      }),
    });

    await el.showUsage("common/a.yaml");

    expect(content().message).toBe("packages.usage_none");
    expect(content().more).toBeUndefined();
  });

  it("doesn't claim nobody uses the file while devices are unchecked", async () => {
    const { el, content } = await mount({
      getFileUsage: vi.fn().mockResolvedValue({
        used_by: [],
        unknown: ["broken.yaml"],
        referenced_by: [],
        rewritable: [],
      }),
    });

    await el.showUsage("common/a.yaml");

    expect(content().message).toBe("");
  });

  it("toasts with the backend detail and stays closed when the lookup fails", async () => {
    const { el } = await mount({
      getFileUsage: vi
        .fn()
        .mockRejectedValue(new APIError("invalid_args", "invalid file path")),
    });

    await el.showUsage("x.txt");

    expect(dialogOpen(el)).toBe(false);
    expect(notifyError).toHaveBeenCalledWith("packages.usage_failed: invalid file path");
  });
});

describe("file-list-dialog showDependencies", () => {
  it("links each file to its editor", async () => {
    const { el, content } = await mount({
      getDeviceDependencies: vi
        .fn()
        .mockResolvedValue({ files: ["common/a.yaml"], complete: true }),
    });

    await el.showDependencies("kitchen.yaml");

    expect(content().items).toEqual([
      { label: "common/a.yaml", url: "/file/common/a.yaml" },
    ]);
    expect(content().note).toBeUndefined();
  });

  it("flags an incomplete dependency list", async () => {
    const { el, content } = await mount({
      getDeviceDependencies: vi.fn().mockResolvedValue({ files: [], complete: false }),
    });

    await el.showDependencies("kitchen.yaml");

    expect(content().message).toBe("packages.dependencies_none | 0");
    expect(content().note).toBe("packages.dependencies_incomplete");
  });
});
