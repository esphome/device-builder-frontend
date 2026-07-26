// Pins the identity loader: success/failure paths, the late-api retry via
// hostUpdated, rotation refresh, and in-place set() after a rotate.

import { describe, expect, it, vi } from "vitest";

import type { ESPHomeAPI } from "../../src/api/esphome-api.js";
import type { IdentityView } from "../../src/api/types/remote-build.js";
import { RemoteBuildIdentityController } from "../../src/util/remote-build-identity-controller.js";
import { FakeHost } from "../_fake-host.js";

const IDENTITY: IdentityView = {
  dashboard_id: "dash-0",
  pin_sha256: "ab".repeat(32),
  server_version: "1.2.0",
  esphome_version: "2026.6.4",
  listener_bound: true,
};

const apiWith = (impl: () => Promise<IdentityView>): ESPHomeAPI =>
  ({ getRemoteBuildIdentity: vi.fn(impl) }) as unknown as ESPHomeAPI;

describe("RemoteBuildIdentityController", () => {
  it("loads on connect and requests a host update", async () => {
    const host = new FakeHost();
    const api = apiWith(() => Promise.resolve(IDENTITY));
    const ctrl = new RemoteBuildIdentityController(host, () => api);
    ctrl.hostConnected();
    await Promise.resolve();
    expect(ctrl.identity).toEqual(IDENTITY);
    expect(ctrl.loadFailed).toBe(false);
    expect(host.updates).toBeGreaterThan(0);
  });

  it("marks loadFailed on error instead of stranding on loading", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const host = new FakeHost();
    const api = apiWith(() => Promise.reject(new Error("boom")));
    const ctrl = new RemoteBuildIdentityController(host, () => api);
    ctrl.hostConnected();
    await Promise.resolve();
    expect(ctrl.identity).toBeNull();
    expect(ctrl.loadFailed).toBe(true);
    vi.restoreAllMocks();
  });

  it("retries on a later host update once the api context lands", async () => {
    const host = new FakeHost();
    let api: ESPHomeAPI | undefined;
    const ctrl = new RemoteBuildIdentityController(host, () => api);
    ctrl.hostConnected();
    await Promise.resolve();
    expect(ctrl.identity).toBeNull();
    expect(ctrl.loadFailed).toBe(false);
    api = apiWith(() => Promise.resolve(IDENTITY));
    ctrl.hostUpdated();
    await Promise.resolve();
    expect(ctrl.identity).toEqual(IDENTITY);
  });

  it("refreshes on a rotation-counter bump and accepts set()", async () => {
    const host = new FakeHost();
    const rotated = { ...IDENTITY, pin_sha256: "cd".repeat(32) };
    let result = IDENTITY;
    const api = apiWith(() => Promise.resolve(result));
    const ctrl = new RemoteBuildIdentityController(host, () => api);
    ctrl.hostConnected();
    await Promise.resolve();
    result = rotated;
    ctrl.onRotationCounterChanged();
    await Promise.resolve();
    expect(ctrl.identity).toEqual(rotated);
    ctrl.set(IDENTITY);
    expect(ctrl.identity).toEqual(IDENTITY);
  });
});
