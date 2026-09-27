/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/tooltip/tooltip.js", () => ({}));

import { DeviceState } from "../../src/api/types/devices.js";
import { mountDeviceCard as mount } from "./_device-card.js";

function badgeText(el: HTMLElement): string {
  return el.shadowRoot!.querySelector(".device-status")!.textContent!.trim();
}

const nowSeconds = () => Date.now() / 1000;

// The default stub drops params; echo them so the duration is visible.
const localize = (key: string, values?: Record<string, string | number>) =>
  values === undefined ? key : `${key}:${Object.values(values).join(",")}`;

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("device-card offline duration", () => {
  it("renders the duration once the backend has an anchor", async () => {
    const el = await mount({
      _localize: localize,
      state: DeviceState.OFFLINE,
      offlineSince: nowSeconds() - 7200,
    });
    expect(badgeText(el)).toContain("2h");
  });

  it("stays a bare label when the backend has no anchor", async () => {
    const el = await mount({
      _localize: localize,
      state: DeviceState.OFFLINE,
      offlineSince: null,
    });
    expect(badgeText(el)).toBe("dashboard.offline");
  });

  it("leaves an online device alone", async () => {
    const el = await mount({
      _localize: localize,
      state: DeviceState.ONLINE,
      offlineSince: nowSeconds() - 7200,
    });
    expect(badgeText(el)).toBe("dashboard.online");
  });

  it("advances with wall-clock, with no new listing and no anchor property", async () => {
    vi.useFakeTimers();
    const el = await mount({
      _localize: localize,
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
      _localize: localize,
      state: DeviceState.OFFLINE,
      offlineSince: nowSeconds() - 30,
      busy: true,
    });
    expect(vi.getTimerCount()).toBe(0);

    el.busy = false;
    await el.updateComplete;
    expect(vi.getTimerCount()).toBe(1);
  });

  it("does not drift when an unrelated listing arrives", async () => {
    vi.useFakeTimers();
    const since = nowSeconds() - 7200;
    const el = await mount({
      _localize: localize,
      state: DeviceState.OFFLINE,
      offlineSince: since,
    });
    expect(badgeText(el)).toContain("2h");

    await vi.advanceTimersByTimeAsync(600_000);
    // As a fresh listing would re-deliver it.
    el.offlineSince = since;
    await el.updateComplete;

    expect(badgeText(el)).toContain("2h 10m");
  });
});
