/** @vitest-environment happy-dom */
import "../../_mock-webawesome.js";

import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/checkbox/checkbox.js", () => ({}));

import { baseDialogSettled, dialogOpen, stubDialogRequestClose } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { APIError } from "../../../src/api/api-error.js";
import type { FileUsage } from "../../../src/api/types/files.js";
import { ESPHomeRenameFileDialog } from "../../../src/components/packages/rename-file-dialog.js";

vi.mock("../../../src/util/notify.js", () => ({ notifyError: vi.fn() }));
const { notifyError } = await import("../../../src/util/notify.js");

async function openDialog(
  usage: Partial<FileUsage> = {}
): Promise<ESPHomeRenameFileDialog> {
  const el = new ESPHomeRenameFileDialog();
  const reply: FileUsage = {
    used_by: [],
    unknown: [],
    referenced_by: usage.rewritable ?? [],
    rewritable: [],
    unreadable: [],
    ...usage,
  };
  Object.assign(el, {
    _api: { getFileUsage: vi.fn().mockResolvedValue(reply) },
    _devices: [
      makeConfiguredDevice({ configuration: "kitchen.yaml", friendly_name: "Kitchen" }),
    ],
  });
  document.body.appendChild(el);
  await baseDialogSettled(el);
  await el.open("common/base.yaml");
  await baseDialogSettled(el);
  stubDialogRequestClose(el);
  return el;
}

async function type(el: ESPHomeRenameFileDialog, value: string) {
  const input = el.shadowRoot!.querySelector(".name input") as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await el.updateComplete;
}

const confirmButton = (el: ESPHomeRenameFileDialog) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(".btn--primary")!;

const checkboxes = (el: ESPHomeRenameFileDialog) => [
  ...el.shadowRoot!.querySelectorAll<HTMLInputElement & Element>("wa-checkbox"),
];

describe("rename-file-dialog", () => {
  it("edits the file name after a fixed folder, Rename disabled until it changes", async () => {
    const el = await openDialog();
    expect(el.shadowRoot!.querySelector(".folder")!.textContent).toBe("common/");
    expect(el.shadowRoot!.querySelector<HTMLInputElement>(".name input")!.value).toBe(
      "base.yaml"
    );
    expect(confirmButton(el).disabled).toBe(true);
  });

  it.each([
    ["shared/base.yaml", "packages.rename_name_only"],
    ["base.txt", "packages.path_needs_yaml"],
    ["base 1.yaml", "packages.path_characters"],
    ["@main.yaml", "packages.path_start"],
  ])("flags %j", async (value, key) => {
    const el = await openDialog();
    await type(el, value);
    expect(el.shadowRoot!.querySelector(".problem")?.textContent).toBe(key);
    expect(confirmButton(el).disabled).toBe(true);
  });

  it("lists every file to rewrite, ticked: devices by name, archived ones marked", async () => {
    const el = await openDialog({
      used_by: ["kitchen.yaml", "garage.yaml"],
      rewritable: ["archive/old.yaml", "bridge/plug.yaml", "kitchen.yaml"],
      unreadable: [],
    });
    expect(el.shadowRoot!.querySelector(".usage-message")?.textContent).toContain(
      "packages.rename_referrers"
    );
    const rows = [...el.shadowRoot!.querySelectorAll(".check-row")];
    expect(rows.map((r) => r.querySelector(".link-label")?.textContent)).toEqual([
      "archive/old.yaml",
      "bridge/plug.yaml",
      "Kitchen",
    ]);
    expect(rows.map((r) => r.querySelector(".link-detail")?.textContent)).toEqual([
      "packages.rename_archived",
      undefined,
      "kitchen.yaml",
    ]);
    expect(checkboxes(el).every((box) => box.checked)).toBe(true);
  });

  it("lists the files it can't update apart, without a checkbox", async () => {
    const el = await openDialog({
      referenced_by: ["bridge/escaped.yaml", "kitchen.yaml"],
      rewritable: ["kitchen.yaml"],
      unreadable: [],
    });
    const messages = [...el.shadowRoot!.querySelectorAll(".usage-message")].map((m) =>
      m.textContent?.trim()
    );
    expect(messages).toEqual(["packages.rename_referrers", "packages.rename_manual"]);
    expect(checkboxes(el)).toHaveLength(1);
    const plain = el.shadowRoot!.querySelector("span.link-row");
    expect(plain?.textContent).toContain("bridge/escaped.yaml");
  });

  it("names the files it couldn't read", async () => {
    const el = await openDialog({ unreadable: ["bridge/broken.yaml"] });
    const notes = [...el.shadowRoot!.querySelectorAll(".usage-note")].map((n) =>
      n.textContent?.trim()
    );
    expect(notes).toEqual(["packages.usage_unreadable"]);
  });

  it("doesn't claim nothing uses the file when no include can be rewritten", async () => {
    const el = await openDialog({ used_by: ["garage.yaml"], unknown: ["broken.yaml"] });
    expect(el.shadowRoot!.querySelector(".usage-message")?.textContent?.trim()).toBe(
      "packages.rename_no_referrers"
    );
    expect(el.shadowRoot!.querySelector(".check-row")).toBeNull();
    expect(el.shadowRoot!.querySelector(".usage-note")?.textContent).toContain(
      "packages.usage_unknown"
    );
  });

  it("sends the unticked files as skip, and ticks them again on the next open", async () => {
    const el = await openDialog({ rewritable: ["archive/old.yaml", "kitchen.yaml"] });
    const emitted = vi.fn();
    el.addEventListener("rename-file", emitted);
    await type(el, "main.yaml");
    const [archived] = checkboxes(el);
    archived.checked = false;
    archived.dispatchEvent(new Event("change"));
    await el.updateComplete;

    confirmButton(el).click();

    expect((emitted.mock.calls[0][0] as CustomEvent).detail).toEqual({
      path: "common/base.yaml",
      newPath: "common/main.yaml",
      skip: ["archive/old.yaml"],
    });

    await el.open("common/base.yaml");
    await el.updateComplete;
    expect(checkboxes(el).every((box) => box.checked)).toBe(true);
  });

  it("names a device it can't update along with its file", async () => {
    const el = await openDialog({ referenced_by: ["kitchen.yaml"], rewritable: [] });
    const plain = el.shadowRoot!.querySelector("span.link-row")!;
    expect(plain.querySelector(".link-label")?.textContent).toBe("Kitchen");
    expect(plain.querySelector(".link-detail")?.textContent).toBe("kitchen.yaml");
  });

  it("emits once when Rename is clicked again while the dialog closes", async () => {
    const el = await openDialog();
    const emitted = vi.fn();
    el.addEventListener("rename-file", emitted);
    await type(el, "main.yaml");

    confirmButton(el).click();
    confirmButton(el).click();

    expect(emitted).toHaveBeenCalledOnce();
  });

  it("emits the trimmed new path and closes", async () => {
    const el = await openDialog();
    const emitted = vi.fn();
    el.addEventListener("rename-file", emitted);
    await type(el, " main.yaml ");

    confirmButton(el).click();

    expect((emitted.mock.calls[0][0] as CustomEvent).detail).toEqual({
      path: "common/base.yaml",
      newPath: "common/main.yaml",
      skip: [],
    });
    expect(dialogOpen(el)).toBe(false);
  });
});

describe("rename-file-dialog usage lookup", () => {
  it("opens for the latest file when an older lookup answers last", async () => {
    const replies = new Map<string, (usage: FileUsage) => void>();
    const el = new ESPHomeRenameFileDialog();
    Object.assign(el, {
      _api: {
        getFileUsage: vi.fn(
          (path: string) => new Promise((resolve) => replies.set(path, resolve))
        ),
      },
    });
    document.body.appendChild(el);
    await baseDialogSettled(el);
    const usage = {
      used_by: [],
      unknown: [],
      referenced_by: [],
      rewritable: [],
      unreadable: [],
    };

    const first = el.open("common/a.yaml");
    const second = el.open("common/b.yaml");
    replies.get("common/b.yaml")!(usage);
    await second;
    replies.get("common/a.yaml")!(usage);
    await first;
    await el.updateComplete;

    const input = el.shadowRoot!.querySelector<HTMLInputElement>(".name input")!;
    expect(input.value).toBe("b.yaml");
  });

  it("stays closed and toasts when the lookup fails", async () => {
    const el = new ESPHomeRenameFileDialog();
    Object.assign(el, {
      _api: {
        getFileUsage: vi.fn().mockRejectedValue(new APIError("internal_error", "x")),
      },
    });
    document.body.appendChild(el);
    await baseDialogSettled(el);

    await el.open("common/base.yaml");

    expect(dialogOpen(el)).toBe(false);
    expect(notifyError).toHaveBeenCalledWith("packages.usage_failed: x");
  });
});
