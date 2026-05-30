import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import type { LocalizeFunc } from "../../../src/common/localize.js";
import { deleteDevice } from "../../../src/components/dashboard/actions.js";

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner-js", () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const localize = ((key: string) => key) as LocalizeFunc;

function makeDevice(): ConfiguredDevice {
  return {
    name: "kitchen",
    friendly_name: "Kitchen",
    configuration: "kitchen.yaml",
  } as ConfiguredDevice;
}

describe("deleteDevice", () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    toastError.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fires the success toast only after the backend confirms the delete", async () => {
    let resolveDelete!: () => void;
    const api = {
      deleteDevice: vi.fn(
        () =>
          new Promise<void>((r) => {
            resolveDelete = r;
          })
      ),
    } as unknown as ESPHomeAPI;

    const pending = deleteDevice(makeDevice(), api, localize);
    // The delete is still in flight: nothing toasted yet. A deferred
    // promise pins the ordering an immediately-resolved mock can't —
    // an optimistic toast fired before the await would show up here
    // and fail the test.
    expect(toastSuccess).not.toHaveBeenCalled();

    resolveDelete();
    const ok = await pending;

    expect(ok).toBe(true);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("toasts an error and reports failure when the backend rejects", async () => {
    const api = {
      deleteDevice: vi.fn(async () => {
        throw new Error("backend said no");
      }),
    } as unknown as ESPHomeAPI;

    const ok = await deleteDevice(makeDevice(), api, localize);

    expect(ok).toBe(false);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
