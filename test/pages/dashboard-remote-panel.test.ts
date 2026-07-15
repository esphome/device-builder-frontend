/**
 * @vitest-environment happy-dom
 *
 * Pins the dashboard's dual-stack behavior: the remote compute stack shows
 * expanded (builder collapsed) when the preference is on, appears collapsed
 * as soon as any sender pairs, and stays away otherwise. Nothing is hidden —
 * creation affordances render whenever the builder stack is expanded.
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
import { JobStatus } from "../../src/api/types/firmware-jobs.js";
import type { PeerSummary } from "../../src/api/types/remote-build.js";
import {
  clearTourPending,
  setTourActive,
  setTourPending,
} from "../../src/components/guided-tour/tour-session.js";
import type { ESPHomeRemoteBuildPanel } from "../../src/components/remote-build-panel.js";
import { ESPHomePageDashboard } from "../../src/pages/dashboard.js";
import { flushMicrotasks } from "../_dom.js";
import { makeConfiguredDevice } from "../_make-configured-device.js";
import { makeFirmwareJob } from "../_make-firmware-job.js";

function makePeer(overrides: Partial<PeerSummary> = {}): PeerSummary {
  return {
    dashboard_id: "dash-1",
    pin_sha256: "ab".repeat(32),
    label: "office",
    paired_at: 1_700_000_000,
    status: "approved",
    peer_ip: "192.168.1.42",
    connected: true,
    ...overrides,
  };
}

async function mountDashboard(opts: {
  remote?: boolean;
  hideBuilder?: boolean;
  prefsLoaded?: boolean;
  devices?: ConfiguredDevice[];
  peers?: PeerSummary[] | null;
}): Promise<ESPHomePageDashboard> {
  const page = new ESPHomePageDashboard();
  // Context-provided fields, seeded directly for a bare mount.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._remoteComputeOnly = opts.remote ?? false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._hideDeviceBuilder = opts.hideBuilder ?? false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._prefsLoaded = opts.prefsLoaded ?? true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._devicesLoaded = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._devices = opts.devices ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._buildServerPeers = opts.peers ?? null;
  document.body.appendChild(page);
  await page.updateComplete;
  await flushMicrotasks(8);
  return page;
}

const panelIn = (page: ESPHomePageDashboard) =>
  page.shadowRoot?.querySelector<ESPHomeRemoteBuildPanel>("esphome-remote-build-panel") ??
  null;
const gridIn = (page: ESPHomePageDashboard) =>
  page.shadowRoot?.querySelector(".devices-grid") ?? null;
const builderHeaderIn = (page: ESPHomePageDashboard) =>
  page.shadowRoot?.querySelector<HTMLButtonElement>(".builder-stack-header") ?? null;

describe("dashboard remote-compute stacks", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    sessionStorage.clear();
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
    sessionStorage.clear();
    setTourActive(false);
    clearTourPending();
    vi.restoreAllMocks();
  });

  it("preference on: remote stack expanded, builder collapsed", async () => {
    const page = await mountDashboard({ remote: true });
    const panel = panelIn(page);
    expect(panel).not.toBeNull();
    expect(panel!.collapsed).toBe(false);
    const header = builderHeaderIn(page);
    expect(header?.getAttribute("aria-expanded")).toBe("false");
    expect(gridIn(page)).toBeNull();
  });

  it("the no-peers walkthrough scrolls as a unit inside the panel", async () => {
    const page = await mountDashboard({ remote: true, peers: [] });
    const panel = panelIn(page)!;
    // Context-provided panel fields, seeded directly for a bare mount.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (panel as any)._remoteBuildEnabled = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (panel as any)._peers = [];
    await panel.updateComplete;
    const scroller = panel.shadowRoot?.querySelector(".onboarding");
    expect(scroller).not.toBeNull();
    expect(scroller?.querySelector(".steps")).not.toBeNull();
  });

  it("swapping to the builder collapses the remote stack (accordion)", async () => {
    const page = await mountDashboard({ remote: true, devices: [] });
    builderHeaderIn(page)!.click();
    await page.updateComplete;
    expect(gridIn(page)).not.toBeNull();
    expect(page.shadowRoot?.querySelector(".add-device-card")).not.toBeNull();
    expect(panelIn(page)!.collapsed).toBe(true);
  });

  it("appears collapsed once a sender pairs, with the builder expanded", async () => {
    const page = await mountDashboard({
      remote: false,
      devices: [makeConfiguredDevice()],
      peers: [makePeer()],
    });
    const panel = panelIn(page);
    expect(panel).not.toBeNull();
    expect(panel!.collapsed).toBe(true);
    expect(builderHeaderIn(page)?.getAttribute("aria-expanded")).toBe("true");
    expect(gridIn(page)).not.toBeNull();
  });

  it("banner click swaps to the remote stack and persists for the session", async () => {
    const page = await mountDashboard({ remote: false, peers: [makePeer()] });
    const panel = panelIn(page)!;
    panel.shadowRoot?.querySelector<HTMLButtonElement>(".banner")?.click();
    await page.updateComplete;
    expect(panel.collapsed).toBe(false);
    expect(builderHeaderIn(page)?.getAttribute("aria-expanded")).toBe("false");
    expect(sessionStorage.getItem("esphome-dashboard-stacks")).toBe("remote");
  });

  it("clicking the open section's header swaps to the other (never both closed)", async () => {
    const page = await mountDashboard({ remote: true });
    const panel = panelIn(page)!;
    expect(panel.collapsed).toBe(false);
    panel.shadowRoot?.querySelector<HTMLButtonElement>(".banner")?.click();
    await page.updateComplete;
    expect(panel.collapsed).toBe(true);
    expect(builderHeaderIn(page)?.getAttribute("aria-expanded")).toBe("true");
  });

  it("hide_device_builder leaves only the expanded panel, no banner", async () => {
    const page = await mountDashboard({
      remote: true,
      hideBuilder: true,
      devices: [makeConfiguredDevice()],
    });
    const panel = panelIn(page)!;
    expect(panel.collapsed).toBe(false);
    expect(panel.solo).toBe(true);
    // No builder section, no grid, no FAB / select bar.
    expect(builderHeaderIn(page)).toBeNull();
    expect(gridIn(page)).toBeNull();
    expect(page.shadowRoot?.querySelector("esphome-fab")).toBeNull();
    // No accordion banner at all — the panel content is the page.
    await panel.updateComplete;
    expect(panel.shadowRoot?.querySelector(".banner")).toBeNull();
    expect(panel.shadowRoot?.querySelector(".stack-bar-chevron")).toBeNull();
  });

  it("hide_device_builder is ignored without the remote-compute pref", async () => {
    const page = await mountDashboard({
      remote: false,
      hideBuilder: true,
      peers: [makePeer()],
    });
    expect(builderHeaderIn(page)).not.toBeNull();
    expect(panelIn(page)!.collapsed).toBe(true);
  });

  it("a live tour overrides hide_device_builder so its anchors exist", async () => {
    setTourPending();
    const page = await mountDashboard({ remote: true, hideBuilder: true });
    setTourActive(true);
    await page.updateComplete;
    expect(builderHeaderIn(page)).not.toBeNull();
    expect(panelIn(page)!.collapsed).toBe(true);
    setTourActive(false);
    await page.updateComplete;
    expect(builderHeaderIn(page)).toBeNull();
    expect(panelIn(page)!.collapsed).toBe(false);
  });

  it("a paused tour releases the forced builder section", async () => {
    setTourPending();
    const page = await mountDashboard({ remote: false, peers: [makePeer()] });
    setTourActive(true);
    await page.updateComplete;
    const panel = panelIn(page)!;
    panel.shadowRoot?.querySelector<HTMLButtonElement>(".banner")?.click();
    await page.updateComplete;
    expect(panel.collapsed).toBe(true);
    // Click-outside pause clears active but keeps the pending resume key.
    setTourActive(false);
    await page.updateComplete;
    expect(panel.collapsed).toBe(false);
  });

  it("collapsed banner badges waiting requests and active jobs", async () => {
    const page = await mountDashboard({
      remote: false,
      peers: [makePeer(), makePeer({ dashboard_id: "dash-2", status: "pending" })],
    });
    const panel = panelIn(page)!;
    expect(panel.collapsed).toBe(true);
    // The bare page mount has no context providers; seed the panel's
    // consumed fields directly like the page's own.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (panel as any)._peers = [makePeer({ dashboard_id: "dash-2", status: "pending" })];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (panel as any)._jobs = new Map([
      ["job-1", makeFirmwareJob({ status: JobStatus.RUNNING })],
    ]);
    await panel.updateComplete;
    const banner = panel.shadowRoot?.querySelector(".banner");
    expect(banner?.textContent).toContain("remote_build_dashboard.badge_requests");
    expect(banner?.textContent).toContain("remote_build_dashboard.badge_active");
  });

  it("a pending-only request does not surface the stacks", async () => {
    const page = await mountDashboard({
      remote: false,
      devices: [makeConfiguredDevice()],
      peers: [makePeer({ status: "pending" })],
    });
    expect(panelIn(page)).toBeNull();
    expect(builderHeaderIn(page)).toBeNull();
  });

  it("stays out of the way with no preference and no senders", async () => {
    const page = await mountDashboard({
      remote: false,
      devices: [makeConfiguredDevice()],
    });
    expect(panelIn(page)).toBeNull();
    expect(builderHeaderIn(page)).toBeNull();
    expect(gridIn(page)).not.toBeNull();
  });

  it("waits for preferences before honouring the toggle", async () => {
    const page = await mountDashboard({ remote: true, prefsLoaded: false });
    expect(panelIn(page)).toBeNull();
  });

  it("the create FAB belongs to the builder stack", async () => {
    const page = await mountDashboard({ remote: true, devices: [] });
    expect(page.shadowRoot?.querySelector(".fab-btn")).toBeNull();
    builderHeaderIn(page)!.click();
    await page.updateComplete;
    expect(page.shadowRoot?.querySelector(".fab-btn")).not.toBeNull();
  });
});
