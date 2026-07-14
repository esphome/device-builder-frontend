/**
 * @vitest-environment happy-dom
 *
 * Pins the remote-compute-only dashboard takeover: with zero devices the
 * remote-build panel owns the page; with devices it stacks above the grid;
 * and it fails closed while preferences haven't loaded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
// Rendering the loaded dashboard mounts every dialog child, and each
// wa-dialog's internal form-associated elements (WaButton, WaCheckbox)
// crash under happy-dom. The layout assertions here don't touch them,
// so no-op the heavy children (device-platform-ready idiom).
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

import type { ConfiguredDevice } from "../../src/api/types/devices.js";
import { ESPHomePageDashboard } from "../../src/pages/dashboard.js";
import { flushMicrotasks } from "../_dom.js";
import { makeConfiguredDevice } from "../_make-configured-device.js";

async function mountDashboard(opts: {
  remote: boolean;
  prefsLoaded: boolean;
  devices: ConfiguredDevice[];
}): Promise<ESPHomePageDashboard> {
  const page = new ESPHomePageDashboard();
  // Context-provided fields, seeded directly for a bare mount.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._remoteComputeOnly = opts.remote;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._prefsLoaded = opts.prefsLoaded;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._devicesLoaded = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._devices = opts.devices;
  document.body.appendChild(page);
  await page.updateComplete;
  await flushMicrotasks(8);
  return page;
}

const panelIn = (page: ESPHomePageDashboard) =>
  page.shadowRoot?.querySelector("esphome-remote-build-panel") ?? null;
const gridIn = (page: ESPHomePageDashboard) =>
  page.shadowRoot?.querySelector(".devices-grid") ?? null;

describe("dashboard remote-build panel takeover", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
    vi.restoreAllMocks();
  });

  it("takes over the whole page with zero devices", async () => {
    const page = await mountDashboard({
      remote: true,
      prefsLoaded: true,
      devices: [],
    });
    expect(panelIn(page)).not.toBeNull();
    expect(gridIn(page)).toBeNull();
  });

  it("stacks above the device grid when devices exist", async () => {
    const page = await mountDashboard({
      remote: true,
      prefsLoaded: true,
      devices: [makeConfiguredDevice()],
    });
    const panel = panelIn(page);
    const grid = gridIn(page);
    expect(panel).not.toBeNull();
    expect(grid).not.toBeNull();
    expect(
      panel!.compareDocumentPosition(grid!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("fails closed while preferences haven't loaded", async () => {
    const page = await mountDashboard({
      remote: true,
      prefsLoaded: false,
      devices: [],
    });
    expect(panelIn(page)).toBeNull();
  });

  it("stays out of the way on a normal install", async () => {
    const page = await mountDashboard({
      remote: false,
      prefsLoaded: true,
      devices: [makeConfiguredDevice()],
    });
    expect(panelIn(page)).toBeNull();
    expect(gridIn(page)).not.toBeNull();
  });
});
