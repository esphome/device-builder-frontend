/** @vitest-environment happy-dom */
import "../../_mock-webawesome.js";

import { describe, expect, it, vi } from "vitest";
import { baseDialogSettled, dialogOpen, stubDialogRequestClose } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { APIError } from "../../../src/api/api-error.js";
import { ESPHomeRenameFileDialog } from "../../../src/components/packages/rename-file-dialog.js";

vi.mock("../../../src/util/notify.js", () => ({ notifyError: vi.fn() }));
const { notifyError } = await import("../../../src/util/notify.js");

async function openDialog(
  used_by: string[] = [],
  unknown: string[] = []
): Promise<ESPHomeRenameFileDialog> {
  const el = new ESPHomeRenameFileDialog();
  Object.assign(el, {
    _api: { getFileUsage: vi.fn().mockResolvedValue({ used_by, unknown }) },
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
  const input = el.shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await el.updateComplete;
}

const confirmButton = (el: ESPHomeRenameFileDialog) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(".btn--primary")!;

describe("rename-file-dialog", () => {
  it("edits the file name after a fixed folder, Rename disabled until it changes", async () => {
    const el = await openDialog();
    expect(el.shadowRoot!.querySelector(".folder")!.textContent).toBe("common/");
    expect(el.shadowRoot!.querySelector("input")!.value).toBe("base.yaml");
    expect(confirmButton(el).disabled).toBe(true);
  });

  it.each([
    ["shared/base.yaml", "packages.rename_name_only"],
    ["base.txt", "packages.path_needs_yaml"],
    ["base 1.yaml", "packages.path_characters"],
  ])("flags %j", async (value, key) => {
    const el = await openDialog();
    await type(el, value);
    expect(el.shadowRoot!.querySelector(".problem")?.textContent).toBe(key);
    expect(confirmButton(el).disabled).toBe(true);
  });

  it("lists the devices whose references get updated", async () => {
    const el = await openDialog(["kitchen.yaml"]);
    expect(el.shadowRoot!.querySelector(".usage-message")?.textContent).toContain(
      "packages.rename_users"
    );
    expect(el.shadowRoot!.querySelector(".link-label")?.textContent).toBe("Kitchen");
  });

  it("names unchecked devices instead of claiming nobody uses the file", async () => {
    const el = await openDialog([], ["broken.yaml"]);
    expect(el.shadowRoot!.querySelector(".usage-message")).toBeNull();
    expect(el.shadowRoot!.querySelector(".usage-note")?.textContent).toContain(
      "packages.usage_unknown"
    );
  });

  it("says nobody uses it only when every device was checked", async () => {
    const el = await openDialog();
    expect(el.shadowRoot!.querySelector(".usage-message")?.textContent?.trim()).toBe(
      "packages.rename_no_users"
    );
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
    });
    expect(dialogOpen(el)).toBe(false);
  });
});

describe("rename-file-dialog usage lookup", () => {
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
