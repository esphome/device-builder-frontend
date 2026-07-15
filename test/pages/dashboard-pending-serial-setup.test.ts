/**
 * @vitest-environment happy-dom
 *
 * Pins that the dashboard resumes a USB "Set it up" stashed from another
 * route: on mount it consumes the pending SerialPort and opens the wizard,
 * including on a remote-compute install (nothing is hidden there).
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
import { flushMicrotasks } from "../_dom.js";

const fakePort = {} as SerialPort;

async function mountDashboard(remoteComputeOnly: boolean): Promise<ESPHomePageDashboard> {
  const page = new ESPHomePageDashboard();
  // Seed the consumed context fields directly before connectedCallback runs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._prefsLoaded = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._remoteComputeOnly = remoteComputeOnly;
  document.body.appendChild(page);
  await page.updateComplete;
  await flushMicrotasks(8);
  return page;
}

describe("dashboard pending serial setup", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    vi.mocked(detectAndOpenWizard).mockClear();
  });

  afterEach(() => {
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

  it("opens the wizard on a remote-compute install too", async () => {
    markPendingSerialSetup(fakePort);
    await mountDashboard(true);
    expect(detectAndOpenWizard).toHaveBeenCalledTimes(1);
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
    await flushMicrotasks(8);
    expect(detectAndOpenWizard).not.toHaveBeenCalled();
  });
});
