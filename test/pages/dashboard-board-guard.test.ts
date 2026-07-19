/**
 * @vitest-environment happy-dom
 *
 * Pins the dashboard's install hard block: every install entry point
 * routes through the board-disagreement guard before opening.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../src/components/accept-peer-dialog.js", () => ({}));
vi.mock("../../src/components/adopt-dialog.js", () => ({}));
vi.mock("../../src/components/api-key-dialog.js", () => ({}));
vi.mock("../../src/components/archived-devices-dialog.js", () => ({}));
vi.mock("../../src/components/clone-device-dialog.js", () => ({}));
vi.mock("../../src/components/command-dialog.js", () => ({}));
vi.mock("../../src/components/confirm-dialog.js", () => ({}));
vi.mock("../../src/components/dashboard/device-drawer.js", () => ({}));
vi.mock("../../src/components/dashboard/device-table.js", () => ({}));
vi.mock("../../src/components/dashboard/table-row-menu.js", () => ({}));
vi.mock("../../src/components/device-card.js", () => ({}));
vi.mock("../../src/components/device/board-reselect-dialog.js", () => ({}));
vi.mock("../../src/components/discovered-device-card.js", () => ({}));
vi.mock("../../src/components/firmware-install-dialog.js", () => ({}));
vi.mock("../../src/components/friendly-name-dialog.js", () => ({}));
vi.mock("../../src/components/install-method-dialog.js", () => ({}));
vi.mock("../../src/components/labels/bulk-labels-dialog.js", () => ({}));
vi.mock("../../src/components/labels/label-dialog.js", () => ({}));
vi.mock("../../src/components/logs-dialog.js", () => ({}));
vi.mock("../../src/components/rename-device-dialog.js", () => ({}));
vi.mock("../../src/components/select-bar.js", () => ({}));
vi.mock("../../src/components/wizard/create-config-dialog.js", () => ({}));
vi.mock("../../src/util/board-change.js", () => ({
  findBoardDisagreement: vi.fn(),
  applyBoardChange: vi.fn(),
  // Real pass-through shape so the stubbed dialog's open() drives the tests.
  openBoardReselect: (
    dialog: { open: (opts: unknown) => Promise<boolean> } | undefined,
    opts: unknown
  ) => dialog?.open(opts) ?? Promise.resolve(false),
}));

import { ESPHomePageDashboard } from "../../src/pages/dashboard.js";
import { findBoardDisagreement } from "../../src/util/board-change.js";
import { makeConfiguredDevice } from "../_make-configured-device.js";

const DEVICE = makeConfiguredDevice({ configuration: "stale.yaml" });

function makePage() {
  const page = new ESPHomePageDashboard();
  const openReselect = vi.fn().mockResolvedValue(true);
  Object.defineProperty(page, "_boardReselectDialog", {
    value: { open: openReselect },
  });
  Object.defineProperty(page, "_commandDialog", {
    value: { openForDevice: vi.fn() },
  });
  Object.assign(page, { _activeJobs: new Map(), _devices: [DEVICE] });
  return { page, openReselect };
}

describe("dashboard install hard block", () => {
  it("blocks the install-method picker and opens the reselect dialog", async () => {
    vi.mocked(findBoardDisagreement).mockResolvedValue("esp32:\n  variant: esp32s3\n");
    const { page, openReselect } = makePage();
    page._openInstallMethod(DEVICE);
    await vi.waitFor(() => expect(openReselect).toHaveBeenCalledTimes(1));
    expect(openReselect).toHaveBeenCalledWith({
      configuration: "stale.yaml",
      yaml: "esp32:\n  variant: esp32s3\n",
    });
    expect(page._installMethodOpen).toBe(false);
  });

  it("blocks the direct update install the same way", async () => {
    vi.mocked(findBoardDisagreement).mockResolvedValue("esp32:\n  variant: esp32s3\n");
    const { page, openReselect } = makePage();
    page._openCommand(DEVICE, "install");
    await vi.waitFor(() => expect(openReselect).toHaveBeenCalledTimes(1));
    expect(page._commandDialog.openForDevice).not.toHaveBeenCalled();
  });

  it("falls through when the picker has nothing to offer", async () => {
    // Blocking with only a toast would strand the install; the chip
    // check downstream stays the guard.
    vi.mocked(findBoardDisagreement).mockResolvedValue("esp32:\n  variant: esp32s3\n");
    const { page, openReselect } = makePage();
    openReselect.mockResolvedValue(false);
    page._openInstallMethod(DEVICE);
    await vi.waitFor(() => expect(page._installMethodOpen).toBe(true));
    expect(openReselect).toHaveBeenCalledTimes(1);
  });

  it("proceeds when the YAML and board agree", async () => {
    vi.mocked(findBoardDisagreement).mockResolvedValue(null);
    const { page, openReselect } = makePage();
    page._openInstallMethod(DEVICE);
    await vi.waitFor(() => expect(page._installMethodOpen).toBe(true));
    expect(openReselect).not.toHaveBeenCalled();
  });

  it("leaves non-install commands ungated", () => {
    vi.mocked(findBoardDisagreement).mockResolvedValue("esp32:\n  variant: esp32s3\n");
    const { page, openReselect } = makePage();
    page._openCommand(DEVICE, "clean");
    expect(page._commandDialog.openForDevice).toHaveBeenCalledTimes(1);
    expect(openReselect).not.toHaveBeenCalled();
  });
});
