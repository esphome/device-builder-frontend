import { describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { LocalizeFunc } from "../../../src/common/localize.js";
import {
  confirmDialogCopy,
  executeConfirm,
  type PendingConfirm,
} from "../../../src/components/dashboard/render-dialogs.js";
import type { ESPHomePageDashboard } from "../../../src/pages/dashboard.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock("sonner-js", () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

// Embed interpolation params so assertions see the surfaced name / reason.
const localize = ((key: string, params?: Record<string, string>) =>
  params ? `${key} ${Object.values(params).join(" ")}` : key) as unknown as LocalizeFunc;

function makeHost(firmwareClearQueuedUpdate: ESPHomeAPI["firmwareClearQueuedUpdate"]) {
  return {
    _api: { firmwareClearQueuedUpdate } as unknown as ESPHomeAPI,
    _localize: localize,
  } as unknown as ESPHomePageDashboard;
}

describe("clear-queued-update confirm", () => {
  it("is a non-destructive confirm naming the device", () => {
    const copy = confirmDialogCopy(
      { kind: "clear-queued-update", device: makeConfiguredDevice() },
      localize,
      0,
      () => ({})
    );

    expect(copy.heading).toBe("dashboard.queued_update_confirm_title");
    expect(copy.message).toContain("Kitchen");
    expect(copy.confirm).toBe("dashboard.action_clear_queued");
    expect(copy.destructive).toBe(false);
  });

  it("clears via the API and toasts success", async () => {
    const clear = vi.fn(async () => {});
    const host = makeHost(clear as unknown as ESPHomeAPI["firmwareClearQueuedUpdate"]);
    const pending: PendingConfirm = {
      kind: "clear-queued-update",
      device: makeConfiguredDevice(),
    };

    executeConfirm(host, pending);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(clear).toHaveBeenCalledWith("kitchen.yaml");
    expect(toastSuccess.mock.lastCall![0]).toContain("Kitchen");
  });

  it("surfaces the backend error in a toast on failure", async () => {
    const clear = vi.fn(async () => {
      throw new Error("flag already cleared");
    });
    const host = makeHost(clear as unknown as ESPHomeAPI["firmwareClearQueuedUpdate"]);
    const pending: PendingConfirm = {
      kind: "clear-queued-update",
      device: makeConfiguredDevice(),
    };

    executeConfirm(host, pending);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(toastError.mock.lastCall![0]).toContain("flag already cleared");
  });
});
