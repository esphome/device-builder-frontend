/**
 * @vitest-environment happy-dom
 *
 * Pins that the dashboard resumes a USB "Set it up" stashed from another
 * route: on mount it consumes the pending SerialPort and opens the wizard,
 * still honouring the _hideDeviceCreation gate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markPendingSerialSetup } from "../../src/util/pending-serial-setup.js";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

vi.mock("../../src/components/dashboard/actions.js", async (importActual) => ({
  ...(await importActual<typeof import("../../src/components/dashboard/actions.js")>()),
  detectAndOpenWizard: vi.fn(async () => {}),
}));

import { detectAndOpenWizard } from "../../src/components/dashboard/actions.js";
import { ESPHomePageDashboard } from "../../src/pages/dashboard.js";

const fakePort = {} as SerialPort;

async function flushPending(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function mountDashboard(
  hideDeviceCreation: boolean
): Promise<ESPHomePageDashboard> {
  const page = new ESPHomePageDashboard();
  // _hideDeviceCreation is `_remoteComputeOnly || !_prefsLoaded`; seed the
  // consumed context fields directly before connectedCallback runs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._prefsLoaded = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._remoteComputeOnly = hideDeviceCreation;
  document.body.appendChild(page);
  await page.updateComplete;
  await flushPending();
  return page;
}

describe("dashboard pending serial setup", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    vi.mocked(detectAndOpenWizard).mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    window.history.replaceState({}, "", "/");
  });

  it("opens the wizard with the stashed port on mount", async () => {
    markPendingSerialSetup(fakePort);
    await mountDashboard(false);
    expect(detectAndOpenWizard).toHaveBeenCalledTimes(1);
    expect(vi.mocked(detectAndOpenWizard).mock.calls[0][2]!.port).toBe(fakePort);
  });

  it("does nothing when there is no pending port", async () => {
    await mountDashboard(false);
    expect(detectAndOpenWizard).not.toHaveBeenCalled();
  });

  it("suppresses the wizard when device creation is hidden", async () => {
    markPendingSerialSetup(fakePort);
    await mountDashboard(true);
    expect(detectAndOpenWizard).not.toHaveBeenCalled();
  });

  it("does not open the wizard if the dashboard is torn down before first render", async () => {
    markPendingSerialSetup(fakePort);
    const page = new ESPHomePageDashboard();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (page as any)._prefsLoaded = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (page as any)._remoteComputeOnly = false;
    document.body.appendChild(page); // connectedCallback consumes + schedules
    page.remove(); // disconnect before updateComplete resolves
    await page.updateComplete;
    await flushPending();
    expect(detectAndOpenWizard).not.toHaveBeenCalled();
  });
});
