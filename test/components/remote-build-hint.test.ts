import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/util/notify.js", () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

import type { PairingSummary } from "../../src/api/types/remote-build.js";
import {
  canResetBuildEnv,
  resetRemoteBuildEnv,
  type RemoteBuildResetHost,
} from "../../src/components/remote-build-hint.js";
import { notifyError, notifySuccess } from "../../src/util/notify.js";

function pairing(overrides: Partial<PairingSummary> = {}): PairingSummary {
  return {
    receiver_hostname: "mac.local",
    receiver_port: 6055,
    pin_sha256: "a".repeat(64),
    label: "mac",
    paired_at: 1,
    status: "approved",
    connected: true,
    connecting: false,
    last_connect_error: "",
    esphome_version: "2026.6.5",
    enabled: true,
    auto_provision_supported: false,
    friendly_name: "",
    ha_addon: false,
    reset_build_env_supported: true,
    ...overrides,
  };
}

describe("canResetBuildEnv", () => {
  it("is true for an approved, connected, capable pairing", () => {
    expect(canResetBuildEnv(pairing())).toBe(true);
  });

  it("is false without the capability, when disconnected, or when pending", () => {
    expect(canResetBuildEnv(pairing({ reset_build_env_supported: false }))).toBe(false);
    expect(canResetBuildEnv(pairing({ connected: false }))).toBe(false);
    expect(canResetBuildEnv(pairing({ status: "pending" }))).toBe(false);
  });
});

describe("resetRemoteBuildEnv", () => {
  function makeHost(
    overrides: Partial<RemoteBuildResetHost> = {}
  ): RemoteBuildResetHost & {
    _api: { remoteBuildResetPeerBuildEnv: ReturnType<typeof vi.fn> };
  } {
    return {
      _localize: (key: string, values?: Record<string, unknown>) =>
        values ? `${key}:${JSON.stringify(values)}` : key,
      _remoteResetPending: false,
      _api: { remoteBuildResetPeerBuildEnv: vi.fn(async () => ({ accepted: true })) },
      ...overrides,
    } as never;
  }

  it("calls the api, toasts success, and clears the in-flight guard", async () => {
    const host = makeHost();
    await resetRemoteBuildEnv(host, "pin-1");
    expect(host._api.remoteBuildResetPeerBuildEnv).toHaveBeenCalledWith({
      pin_sha256: "pin-1",
    });
    expect(notifySuccess).toHaveBeenCalled();
    expect(host._remoteResetPending).toBe(false);
  });

  it("toasts the error and clears the guard on failure", async () => {
    const host = makeHost();
    host._api.remoteBuildResetPeerBuildEnv.mockRejectedValueOnce(new Error("boom"));
    await resetRemoteBuildEnv(host, "pin-1");
    expect(notifyError).toHaveBeenCalled();
    expect(host._remoteResetPending).toBe(false);
  });

  it("no-ops when a reset is already in flight or the api is absent", async () => {
    const busy = makeHost({ _remoteResetPending: true });
    await resetRemoteBuildEnv(busy, "pin-1");
    expect(busy._api.remoteBuildResetPeerBuildEnv).not.toHaveBeenCalled();

    const noApi = makeHost();
    (noApi as { _api: undefined })._api = undefined;
    await resetRemoteBuildEnv(noApi, "pin-1");
    // Nothing threw; the guard stayed false.
    expect(noApi._remoteResetPending).toBe(false);
  });
});
