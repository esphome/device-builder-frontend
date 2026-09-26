/**
 * @vitest-environment happy-dom
 *
 * The offline pill's duration suffix: opt-in, and only when the backend
 * has an anchor to measure from.
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

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("device-card offline duration", () => {
  it("appends the duration when the preference is on", async () => {
    const el = await mount({
      state: DeviceState.OFFLINE,
      offlineSeconds: 7200,
      offlineAnchor: Date.now(),
      _offlineDurationVisible: true,
    });
    expect(badgeText(el)).toContain("2h");
  });

  it("stays a bare label while the preference is off", async () => {
    const el = await mount({
      state: DeviceState.OFFLINE,
      offlineSeconds: 7200,
      offlineAnchor: Date.now(),
      _offlineDurationVisible: false,
    });
    expect(badgeText(el)).not.toContain("2h");
  });

  it("stays a bare label when the backend has no anchor", async () => {
    const el = await mount({
      state: DeviceState.OFFLINE,
      offlineSeconds: null,
      offlineAnchor: Date.now(),
      _offlineDurationVisible: true,
    });
    expect(badgeText(el)).toBe("dashboard.offline");
  });

  it("leaves an online device alone", async () => {
    const el = await mount({
      state: DeviceState.ONLINE,
      offlineSeconds: 7200,
      offlineAnchor: Date.now(),
      _offlineDurationVisible: true,
    });
    expect(badgeText(el)).toBe("dashboard.online");
  });

  it("advances when the dashboard's shared tick moves", async () => {
    const anchor = Date.now();
    const el = await mount({
      state: DeviceState.OFFLINE,
      offlineSeconds: 30,
      offlineAnchor: anchor,
      nowMs: anchor,
      _offlineDurationVisible: true,
    });
    expect(badgeText(el)).toContain("30s");

    el.nowMs = anchor + 61_000;
    await el.updateComplete;
    expect(badgeText(el)).toContain("1m");
  });
});
