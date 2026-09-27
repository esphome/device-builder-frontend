/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/tooltip/tooltip.js", () => ({}));

import { argsLocalize } from "../_dom.js";
import { DeviceState } from "../../src/api/types/devices.js";
import { type FirmwareJob, JobStatus } from "../../src/api/types/firmware-jobs.js";
import { mountDeviceCard as mount } from "./_device-card.js";

function badgeText(el: HTMLElement): string {
  return el.shadowRoot!.querySelector(".device-status")!.textContent!.trim();
}

const nowSeconds = () => Date.now() / 1000;

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("device-card offline duration", () => {
  it("renders the duration once the backend has an anchor", async () => {
    const el = await mount({
      _localize: argsLocalize,
      state: DeviceState.OFFLINE,
      offlineSince: nowSeconds() - 7200,
    });
    expect(badgeText(el)).toContain("2h");
  });

  it("shows only the leading unit", async () => {
    const el = await mount({
      _localize: argsLocalize,
      state: DeviceState.OFFLINE,
      offlineSince: nowSeconds() - (5 * 3600 + 15 * 60),
    });
    expect(badgeText(el)).toBe("dashboard.offline_for | 5h");
  });

  it("stays a bare label when the backend has no anchor", async () => {
    const el = await mount({
      _localize: argsLocalize,
      state: DeviceState.OFFLINE,
      offlineSince: null,
    });
    expect(badgeText(el)).toBe("dashboard.offline");
  });

  it("leaves an online device alone", async () => {
    const el = await mount({
      _localize: argsLocalize,
      state: DeviceState.ONLINE,
      offlineSince: nowSeconds() - 7200,
    });
    expect(badgeText(el)).toBe("dashboard.online");
  });

  it("advances with wall-clock between listings", async () => {
    vi.useFakeTimers();
    const el = await mount({
      _localize: argsLocalize,
      state: DeviceState.OFFLINE,
      offlineSince: nowSeconds() - 30,
    });
    expect(badgeText(el)).toContain("30s");

    await vi.advanceTimersByTimeAsync(61_000);
    await el.updateComplete;
    expect(badgeText(el)).toContain("1m");
  });

  it("stops repainting while the busy badge covers the pill", async () => {
    vi.useFakeTimers();
    const el = await mount({
      _localize: argsLocalize,
      state: DeviceState.OFFLINE,
      offlineSince: nowSeconds() - 30,
      busy: true,
    });
    expect(vi.getTimerCount()).toBe(0);

    el.busy = false;
    await el.updateComplete;
    expect(vi.getTimerCount()).toBe(1);
  });

  it("stops repainting while a finished-job badge covers the pill", async () => {
    vi.useFakeTimers();
    const el = await mount({
      _localize: argsLocalize,
      state: DeviceState.OFFLINE,
      offlineSince: nowSeconds() - 30,
      recentJob: { status: JobStatus.FAILED } as FirmwareJob,
    });
    expect(vi.getTimerCount()).toBe(0);

    el.recentJob = null;
    await el.updateComplete;
    expect(vi.getTimerCount()).toBe(1);
  });
});
