/** @vitest-environment happy-dom */
import "../../_mock-webawesome.js";

import { describe, expect, it, vi } from "vitest";
import { argsLocalize, baseDialogSettled, dialogOpen } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { APIError } from "../../../src/api/api-error.js";
import { ESPHomeFileListDialog } from "../../../src/components/packages/file-list-dialog.js";

vi.mock("../../../src/util/notify.js", () => ({ notifyError: vi.fn() }));
const { notifyError } = await import("../../../src/util/notify.js");

interface Rendered {
  messages: string[];
  labels: string[];
  /** Row labels that open an editor. */
  links: string[];
  notes: string[];
}

async function mount(api: object): Promise<{
  el: ESPHomeFileListDialog;
  rendered: () => Promise<Rendered>;
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
  const texts = (selector: string) =>
    [...el.shadowRoot!.querySelectorAll(selector)].map((n) => n.textContent!.trim());
  const rendered = async () => {
    await el.updateComplete;
    return {
      messages: texts(".usage-message"),
      labels: texts(".link-label"),
      links: texts("button.link-row .link-label"),
      notes: texts(".usage-note"),
    };
  };
  return { el, rendered };
}

describe("file-list-dialog showUsage", () => {
  it("lists the using devices by name, then other includers, and notes unchecked ones", async () => {
    const getFileUsage = vi.fn().mockResolvedValue({
      used_by: ["kitchen.yaml"],
      unknown: ["broken.yaml"],
      referenced_by: ["kitchen.yaml", "broken.yaml"],
      rewritable: ["kitchen.yaml", "broken.yaml"],
      unreadable: [],
    });
    const { el, rendered } = await mount({ getFileUsage });

    await el.showUsage("common/a.yaml");

    expect(getFileUsage).toHaveBeenCalledWith("common/a.yaml");
    expect(dialogOpen(el)).toBe(true);
    // a device listed as a user isn't repeated; an unchecked one that includes it is
    expect(await rendered()).toEqual({
      messages: ["packages.usage_message | 1", "packages.usage_other_files | 1"],
      labels: ["Kitchen", "broken.yaml"],
      links: ["Kitchen", "broken.yaml"],
      notes: ["packages.usage_unknown | broken.yaml"],
    });
  });

  it.each([
    ["a package", "bridge/plug.yaml", true],
    ["an archived device", "archive/old.yaml", false],
    ["a device the scanner hasn't loaded", "new-device.yaml", true],
  ])("lists %s that includes the file", async (_, path, linked) => {
    const { el, rendered } = await mount({
      getFileUsage: vi.fn().mockResolvedValue({
        used_by: [],
        unknown: [],
        referenced_by: [path],
        rewritable: [path],
        unreadable: [],
      }),
    });

    await el.showUsage("common/a.yaml");

    expect(await rendered()).toEqual({
      messages: ["packages.usage_other_files | 1"],
      labels: [path],
      links: linked ? [path] : [],
      notes: [],
    });
  });

  it("says nobody uses the file only when nothing includes it", async () => {
    const { el, rendered } = await mount({
      getFileUsage: vi.fn().mockResolvedValue({
        used_by: [],
        unknown: [],
        referenced_by: [],
        rewritable: [],
        unreadable: [],
      }),
    });

    await el.showUsage("common/a.yaml");

    expect((await rendered()).messages).toEqual(["packages.usage_none"]);
  });

  it("doesn't claim nobody uses the file while devices are unchecked", async () => {
    const { el, rendered } = await mount({
      getFileUsage: vi.fn().mockResolvedValue({
        used_by: [],
        unknown: ["broken.yaml"],
        referenced_by: [],
        rewritable: [],
        unreadable: [],
      }),
    });

    await el.showUsage("common/a.yaml");

    expect((await rendered()).messages).toEqual([]);
  });

  it("names the files it couldn't read instead of claiming nobody uses the file", async () => {
    const { el, rendered } = await mount({
      getFileUsage: vi.fn().mockResolvedValue({
        used_by: [],
        unknown: [],
        referenced_by: [],
        rewritable: [],
        unreadable: ["bridge/broken.yaml"],
      }),
    });

    await el.showUsage("common/a.yaml");

    expect(await rendered()).toEqual({
      messages: [],
      labels: [],
      links: [],
      notes: ["packages.usage_unreadable | bridge/broken.yaml"],
    });
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
    const { el, rendered } = await mount({
      getDeviceDependencies: vi
        .fn()
        .mockResolvedValue({ files: ["common/a.yaml"], complete: true }),
    });

    await el.showDependencies("kitchen.yaml");

    expect(await rendered()).toEqual({
      messages: ["packages.dependencies_message | 1"],
      labels: ["common/a.yaml"],
      links: ["common/a.yaml"],
      notes: [],
    });
  });

  it("flags an incomplete dependency list", async () => {
    const { el, rendered } = await mount({
      getDeviceDependencies: vi.fn().mockResolvedValue({ files: [], complete: false }),
    });

    await el.showDependencies("kitchen.yaml");

    expect(await rendered()).toEqual({
      messages: [],
      labels: [],
      links: [],
      notes: ["packages.dependencies_incomplete"],
    });
  });

  it("says a device includes nothing once its list is complete", async () => {
    const { el, rendered } = await mount({
      getDeviceDependencies: vi.fn().mockResolvedValue({ files: [], complete: true }),
    });

    await el.showDependencies("kitchen.yaml");

    expect((await rendered()).messages).toEqual(["packages.dependencies_none | 0"]);
  });

  it("keeps the latest lookup when an older reply arrives last", async () => {
    const replies: Record<string, (v: unknown) => void> = {};
    const reply = (key: string) => new Promise((resolve) => (replies[key] = resolve));
    const { el, rendered } = await mount({
      getFileUsage: vi.fn(() => reply("usage")),
      getDeviceDependencies: vi.fn(() => reply("deps")),
    });

    const usage = el.showUsage("common/a.yaml");
    const deps = el.showDependencies("kitchen.yaml");
    replies.deps({ files: ["common/b.yaml"], complete: true });
    await deps;
    replies.usage({
      used_by: ["kitchen.yaml"],
      unknown: [],
      referenced_by: ["kitchen.yaml"],
      rewritable: [],
      unreadable: [],
    });
    await usage;

    expect((await rendered()).links).toEqual(["common/b.yaml"]);
  });

  it("drops a failed older lookup and any lookup finishing after disconnect", async () => {
    let fail!: (e: unknown) => void;
    let finish!: (v: unknown) => void;
    const { el } = await mount({
      getFileUsage: vi.fn(() => new Promise((_, reject) => (fail = reject))),
      getDeviceDependencies: vi.fn(() => new Promise((resolve) => (finish = resolve))),
    });
    vi.mocked(notifyError).mockClear();

    const usage = el.showUsage("common/a.yaml");
    const deps = el.showDependencies("kitchen.yaml");
    fail(new Error("late"));
    await usage;
    expect(notifyError).not.toHaveBeenCalled();

    el.remove();
    finish({ files: ["common/b.yaml"], complete: true });
    await deps;
    expect(dialogOpen(el)).toBe(false);
  });
});
