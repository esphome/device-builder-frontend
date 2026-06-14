import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import type { LocalizeFunc } from "../../../src/common/localize.js";
import { executeRename } from "../../../src/components/dashboard/actions-ui.js";
import type { ESPHomePageDashboard } from "../../../src/pages/dashboard.js";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner-js", () => ({
  default: {
    success: vi.fn(),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

// Append the interpolation params so the assertion sees the surfaced
// reason; the stub has no access to the en.json template the real
// _localize would expand, so embedding params is what proves the
// handler forwarded the backend detail into the toast.
const localize = ((key: string, params?: Record<string, string>) =>
  params ? `${key} ${Object.values(params).join(" ")}` : key) as unknown as LocalizeFunc;

function makeHost(renameDevice: ESPHomeAPI["renameDevice"]): ESPHomePageDashboard {
  return {
    _actionDevice: {
      name: "rename_test",
      friendly_name: "Rename_Test",
      configuration: "rename_test.yaml",
    } as ConfiguredDevice,
    _api: { renameDevice } as unknown as ESPHomeAPI,
    _localize: localize,
  } as unknown as ESPHomePageDashboard;
}

describe("executeRename", () => {
  beforeEach(() => toastError.mockClear());
  afterEach(() => vi.restoreAllMocks());

  it("surfaces the backend reason in the rename-failure toast", async () => {
    const reason = "A device named rename-test.yaml already exists";
    const renameDevice = vi.fn(async () => {
      throw new Error(`invalid_args: ${reason}`);
    }) as unknown as ESPHomeAPI["renameDevice"];

    await executeRename(
      makeHost(renameDevice),
      new CustomEvent("rename-confirm", {
        detail: "rename-test",
      })
    );

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toContain(reason);
  });
});
