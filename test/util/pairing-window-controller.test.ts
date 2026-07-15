// Pins the PairingWindowController's release discipline (close only what
// this host opened) and the countdown reseed/tick behaviour.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ESPHomeAPI } from "../../src/api/esphome-api.js";
import { PairingWindowController } from "../../src/util/pairing-window-controller.js";
import { FakeHost } from "../_fake-host.js";

function makeApi(reject = false) {
  return {
    setRemoteBuildPairingWindow: reject
      ? vi.fn().mockRejectedValue(new Error("nope"))
      : vi.fn().mockResolvedValue({ open: true, expires_in_seconds: 300 }),
  };
}

function makeController(
  api: ReturnType<typeof makeApi> | undefined,
  opts: { autoOpen?: boolean; onOpenFailed?: () => void } = {}
) {
  const host = new FakeHost();
  const ctrl = new PairingWindowController(host, {
    getApi: () => api as unknown as ESPHomeAPI | undefined,
    ...opts,
  });
  return { host, ctrl };
}

describe("PairingWindowController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("autoOpen opens on connect and releases on disconnect", () => {
    const api = makeApi();
    const { ctrl } = makeController(api, { autoOpen: true });
    ctrl.hostConnected();
    expect(api.setRemoteBuildPairingWindow).toHaveBeenCalledWith({ open: true });
    ctrl.hostDisconnected();
    expect(api.setRemoteBuildPairingWindow).toHaveBeenLastCalledWith({
      open: false,
    });
  });

  it("explicit open is released on disconnect", () => {
    const api = makeApi();
    const { ctrl } = makeController(api);
    ctrl.hostConnected();
    expect(api.setRemoteBuildPairingWindow).not.toHaveBeenCalled();
    ctrl.open();
    ctrl.hostDisconnected();
    expect(api.setRemoteBuildPairingWindow).toHaveBeenLastCalledWith({
      open: false,
    });
  });

  it("a host that never opened the window does not close it", () => {
    const api = makeApi();
    const { ctrl } = makeController(api);
    ctrl.hostConnected();
    ctrl.onStateChanged({ open: true, expires_in_seconds: 120 });
    ctrl.hostDisconnected();
    expect(api.setRemoteBuildPairingWindow).not.toHaveBeenCalled();
  });

  it("a window closed elsewhere clears the release obligation", () => {
    const api = makeApi();
    const { ctrl } = makeController(api);
    ctrl.open();
    api.setRemoteBuildPairingWindow.mockClear();
    ctrl.onStateChanged({ open: false, expires_in_seconds: null });
    ctrl.hostDisconnected();
    expect(api.setRemoteBuildPairingWindow).not.toHaveBeenCalled();
  });

  it("auto-open parks quietly until the api context lands, then opens", () => {
    let api: ReturnType<typeof makeApi> | undefined;
    const onOpenFailed = vi.fn();
    const host = new FakeHost();
    const ctrl = new PairingWindowController(host, {
      getApi: () => api as unknown as ESPHomeAPI | undefined,
      autoOpen: true,
      onOpenFailed,
    });
    ctrl.hostConnected();
    expect(onOpenFailed).not.toHaveBeenCalled();
    ctrl.hostUpdated();
    expect(onOpenFailed).not.toHaveBeenCalled();
    api = makeApi();
    ctrl.hostUpdated();
    expect(api.setRemoteBuildPairingWindow).toHaveBeenCalledWith({ open: true });
    ctrl.hostDisconnected();
    expect(api.setRemoteBuildPairingWindow).toHaveBeenLastCalledWith({
      open: false,
    });
  });

  it("a failed auto-open claims nothing, so disconnect closes nothing", async () => {
    const api = makeApi(true);
    const onOpenFailed = vi.fn();
    const { ctrl } = makeController(api, { autoOpen: true, onOpenFailed });
    ctrl.hostConnected();
    await vi.advanceTimersByTimeAsync(0);
    expect(onOpenFailed).toHaveBeenCalled();
    api.setRemoteBuildPairingWindow.mockClear();
    ctrl.hostDisconnected();
    expect(api.setRemoteBuildPairingWindow).not.toHaveBeenCalled();
  });

  it("a failed open reports and forgets the claim", async () => {
    const api = makeApi(true);
    const onOpenFailed = vi.fn();
    const { ctrl } = makeController(api, { onOpenFailed });
    ctrl.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(onOpenFailed).toHaveBeenCalled();
    api.setRemoteBuildPairingWindow.mockClear();
    ctrl.hostDisconnected();
    expect(api.setRemoteBuildPairingWindow).not.toHaveBeenCalled();
  });

  it("counts down from the pushed baseline and ticks the host", () => {
    const api = makeApi();
    const { host, ctrl } = makeController(api);
    ctrl.onStateChanged({ open: true, expires_in_seconds: 120 });
    expect(ctrl.remainingSeconds()).toBe(120);
    const updatesBefore = host.updates;
    vi.advanceTimersByTime(30_000);
    expect(ctrl.remainingSeconds()).toBe(90);
    expect(host.updates).toBeGreaterThan(updatesBefore);
    ctrl.onStateChanged({ open: false, expires_in_seconds: null });
    expect(ctrl.remainingSeconds()).toBeNull();
  });
});
