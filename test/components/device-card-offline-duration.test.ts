/**
 * @vitest-environment happy-dom
 *
 * The offline pill's duration suffix: shown once the backend knows when the
 * device went away, and ticking without a fresh listing.
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

// The default stub returns the key and drops params; the duration is
// interpolated into the localized string, so echo the values instead.
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

    // The shared clock repaints the card; nothing re-sends the device.
    await vi.advanceTimersByTimeAsync(61_000);
    await el.updateComplete;
    expect(badgeText(el)).toContain("1m");
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
    // Same absolute stamp re-delivered, as a fresh listing would.
    el.offlineSince = since;
    await el.updateComplete;

    // 2h10m, not back to 2h: the value is absolute, not an age plus anchor.
    expect(badgeText(el)).toContain("2h 10m");
  });
});
