/**
 * @vitest-environment happy-dom
 *
 * The remote-reset entry point in the firmware-jobs dialog: resolve the
 * pairing's display name, confirm, enqueue the mirror job, follow it in
 * the command dialog — mirroring the local reset's flow.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/util/notify.js", () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

import type { FirmwareJob } from "../../src/api/types/firmware-jobs.js";
import type { PairingSummary } from "../../src/api/types/remote-build.js";
import { ESPHomeFirmwareJobsDialog } from "../../src/components/firmware-jobs-dialog.js";
import { notifyError } from "../../src/util/notify.js";

beforeEach(() => {
  vi.clearAllMocks();
});

const PIN = "a".repeat(64);

function pairing(overrides: Partial<PairingSummary> = {}): PairingSummary {
  return {
    receiver_hostname: "mac.local",
    receiver_port: 6055,
    pin_sha256: PIN,
    label: "mac-studio",
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

interface DialogInternals {
  _pairings: Map<string, PairingSummary> | null;
  _api: { remoteBuildResetPeerBuildEnv: ReturnType<typeof vi.fn> };
  _localize: (key: string, values?: Record<string, string | number>) => string;
  _pendingResetPeer: { pin_sha256: string; label: string } | null;
  _jobDisplayName: (job: FirmwareJob) => string;
  openResetPeerBuildEnv(pin: string): void;
  _onResetPeerConfirmed: () => Promise<void>;
}

function makeDialog(overrides: Partial<PairingSummary> = {}) {
  const el = new ESPHomeFirmwareJobsDialog() as unknown as DialogInternals;
  el._pairings = new Map([[PIN, pairing(overrides)]]);
  el._localize = (key, values) => (values ? `${key}:${JSON.stringify(values)}` : key);
  const confirm = { open: vi.fn() };
  const followJob = vi.fn();
  // Shadow the @query getters with plain stubs — nothing renders here.
  Object.defineProperty(el, "_resetPeerConfirmDialog", { value: confirm });
  Object.defineProperty(el, "_commandDialog", { value: { followJob } });
  el._api = { remoteBuildResetPeerBuildEnv: vi.fn() };
  return { el, confirm, followJob };
}

describe("openResetPeerBuildEnv", () => {
  it("resolves the display name and opens the confirm for a capable pairing", () => {
    const { el, confirm } = makeDialog();
    el.openResetPeerBuildEnv(PIN);
    expect(el._pendingResetPeer).toEqual({ pin_sha256: PIN, label: "mac-studio" });
    expect(confirm.open).toHaveBeenCalledTimes(1);
  });

  it("no-ops for an unknown pin", () => {
    const { el, confirm } = makeDialog();
    el.openResetPeerBuildEnv("b".repeat(64));
    expect(el._pendingResetPeer).toBeNull();
    expect(confirm.open).not.toHaveBeenCalled();
  });

  it("no-ops when the pairing no longer supports the reset", () => {
    const { el, confirm } = makeDialog({ reset_build_env_supported: false });
    el.openResetPeerBuildEnv(PIN);
    expect(confirm.open).not.toHaveBeenCalled();
  });

  it("no-ops while the pairing is disconnected", () => {
    const { el, confirm } = makeDialog({ connected: false });
    el.openResetPeerBuildEnv(PIN);
    expect(confirm.open).not.toHaveBeenCalled();
  });
});

describe("_onResetPeerConfirmed", () => {
  it("enqueues the mirror job and follows it in the command dialog", async () => {
    const { el, followJob } = makeDialog();
    const job = {
      job_id: "reset-1",
      job_type: "reset_build_env",
    } as unknown as FirmwareJob;
    el._api.remoteBuildResetPeerBuildEnv.mockResolvedValue(job);
    el.openResetPeerBuildEnv(PIN);

    await el._onResetPeerConfirmed();

    expect(el._api.remoteBuildResetPeerBuildEnv).toHaveBeenCalledWith({
      pin_sha256: PIN,
    });
    expect(followJob).toHaveBeenCalledTimes(1);
    expect(followJob.mock.calls[0][0]).toBe(job);
    // Stays set so the closing confirm dialog keeps its label; the next
    // openResetPeerBuildEnv overwrites it.
    expect(el._pendingResetPeer).toEqual({ pin_sha256: PIN, label: "mac-studio" });
  });

  it("toasts the failure with the pairing label when the command rejects", async () => {
    const { el, followJob } = makeDialog();
    el._api.remoteBuildResetPeerBuildEnv.mockRejectedValue(new Error("link down"));
    el.openResetPeerBuildEnv(PIN);

    await el._onResetPeerConfirmed();

    expect(followJob).not.toHaveBeenCalled();
    expect(notifyError).toHaveBeenCalledTimes(1);
    const message = vi.mocked(notifyError).mock.calls[0][0] as string;
    expect(message).toContain("reset_peer_failed");
    expect(message).toContain("mac-studio");
    expect(message).toContain("link down");
  });

  it("no-ops when nothing is pending", async () => {
    const { el, followJob } = makeDialog();
    await el._onResetPeerConfirmed();
    expect(el._api.remoteBuildResetPeerBuildEnv).not.toHaveBeenCalled();
    expect(followJob).not.toHaveBeenCalled();
  });
});
