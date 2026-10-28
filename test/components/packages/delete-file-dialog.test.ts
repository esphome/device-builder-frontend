/** @vitest-environment happy-dom */
import "../../_mock-webawesome.js";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushMicrotasks } from "../../_dom.js";
import { APIError } from "../../../src/api/api-error.js";
import { ESPHomeDeleteFileDialog } from "../../../src/components/packages/delete-file-dialog.js";

vi.mock("../../../src/util/notify.js", () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));
const { notifyError } = await import("../../../src/util/notify.js");

async function mount(api: object) {
  const el = new ESPHomeDeleteFileDialog();
  Object.assign(el, { _api: api });
  document.body.appendChild(el);
  await el.updateComplete;
  const confirm = el.shadowRoot!.querySelector("esphome-confirm-dialog")!;
  const open = vi.fn();
  Object.assign(confirm, { open, close: vi.fn() });
  return { el, confirm, open };
}

beforeEach(() => vi.clearAllMocks());

describe("delete-file-dialog", () => {
  it("lists the users, then deletes and emits file-deleted", async () => {
    const deleteFile = vi.fn().mockResolvedValue(undefined);
    const { el, confirm, open } = await mount({
      getFileUsage: vi.fn().mockResolvedValue({ used_by: ["kitchen.yaml"], unknown: [] }),
      deleteFile,
    });
    const deleted = vi.fn();
    el.addEventListener("file-deleted", deleted);

    await el.open("common/base.yaml");

    expect(open).toHaveBeenCalledOnce();
    expect(confirm.querySelector('[slot="body"]')?.textContent).toContain(
      "packages.delete_used_message"
    );

    confirm.dispatchEvent(new CustomEvent("confirm"));
    await flushMicrotasks(4);

    expect(deleteFile).toHaveBeenCalledWith("common/base.yaml");
    expect((deleted.mock.calls[0][0] as CustomEvent).detail).toEqual({
      path: "common/base.yaml",
    });
  });

  it("doesn't ask when the usage lookup fails", async () => {
    const { el, open } = await mount({
      getFileUsage: vi.fn().mockRejectedValue(new APIError("internal_error", "x")),
    });

    await el.open("common/base.yaml");

    expect(open).not.toHaveBeenCalled();
    expect(notifyError).toHaveBeenCalledWith("packages.usage_failed: x");
  });

  it("a failed delete toasts and emits nothing", async () => {
    const { el, confirm } = await mount({
      getFileUsage: vi.fn().mockResolvedValue({ used_by: [], unknown: [] }),
      deleteFile: vi.fn().mockRejectedValue(new APIError("not_found", "gone")),
    });
    const deleted = vi.fn();
    el.addEventListener("file-deleted", deleted);
    await el.open("common/base.yaml");

    confirm.dispatchEvent(new CustomEvent("confirm"));
    await flushMicrotasks(4);

    expect(deleted).not.toHaveBeenCalled();
    expect(notifyError).toHaveBeenCalledWith("packages.delete_failed: gone");
  });
});
