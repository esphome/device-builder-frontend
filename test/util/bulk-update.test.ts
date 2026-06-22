/**
 * Pins runBulkUpdate: empty list → info toast + no API call, success → start
 * toast + one firmwareInstallBulk call, NO_COMPATIBLE_PEER → bucketed error
 * toast, any other error → generic error toast.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import toast from "sonner-js";
import { APIError } from "../../src/api/api-error.js";
import type { ESPHomeAPI } from "../../src/api/index.js";
import { ErrorCode } from "../../src/api/types/protocol.js";
import type { PairingSummary } from "../../src/api/types/remote-build.js";
import { runBulkUpdate } from "../../src/util/bulk-update.js";

const localize = vi.fn((key: string, _args?: unknown) => key);

function pairing(overrides: Partial<PairingSummary>): PairingSummary {
  return {
    receiver_hostname: "build.local",
    receiver_port: 6055,
    pin_sha256: "a".repeat(64),
    label: "desktop",
    paired_at: 1,
    status: "approved",
    connected: true,
    connecting: false,
    last_connect_error: "",
    esphome_version: "2026.5.0",
    enabled: true,
    ...overrides,
  };
}

function apiWith(impl: () => Promise<unknown>) {
  const firmwareInstallBulk = vi.fn(impl);
  return {
    api: { firmwareInstallBulk } as unknown as ESPHomeAPI,
    firmwareInstallBulk,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("runBulkUpdate", () => {
  it("info-toasts and skips the API call on an empty list", async () => {
    const { api, firmwareInstallBulk } = apiWith(async () => []);
    await runBulkUpdate([], { api, localize, appVersion: "2026.5.0", pairings: [] });
    expect(firmwareInstallBulk).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("layout.update_all_none", {
      richColors: true,
    });
  });

  it("start-toasts and installs the given configurations", async () => {
    const { api, firmwareInstallBulk } = apiWith(async () => []);
    await runBulkUpdate(["a.yaml", "b.yaml"], {
      api,
      localize,
      appVersion: "2026.5.0",
      pairings: [],
    });
    expect(toast.info).toHaveBeenCalledWith("layout.update_all_started", {
      richColors: true,
    });
    // Pin the device count handed to the plural string, not just the key.
    expect(localize).toHaveBeenCalledWith("layout.update_all_started", { count: 2 });
    expect(firmwareInstallBulk).toHaveBeenCalledWith(["a.yaml", "b.yaml"]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("classifies a NO_COMPATIBLE_PEER failure into the offline bucket", async () => {
    const { api } = apiWith(async () => {
      throw new APIError(ErrorCode.NO_COMPATIBLE_PEER, "");
    });
    await runBulkUpdate(["a.yaml"], {
      api,
      localize,
      appVersion: "2026.5.0",
      pairings: [pairing({ connected: false })],
    });
    expect(toast.error).toHaveBeenCalledWith(
      "layout.update_all_no_compatible_peer_offline",
      { richColors: true }
    );
  });

  it("falls back to the generic toast on any other error", async () => {
    const { api } = apiWith(async () => {
      throw new Error("boom");
    });
    await runBulkUpdate(["a.yaml"], {
      api,
      localize,
      appVersion: "2026.5.0",
      pairings: [],
    });
    expect(toast.error).toHaveBeenCalledWith("layout.update_all_error", {
      richColors: true,
    });
  });

  it("uses the generic toast when appVersion is empty during a reconnect race", async () => {
    const { api } = apiWith(async () => {
      throw new APIError(ErrorCode.NO_COMPATIBLE_PEER, "");
    });
    await runBulkUpdate(["a.yaml"], {
      api,
      localize,
      appVersion: "",
      pairings: [pairing({ connected: false })],
    });
    expect(toast.error).toHaveBeenCalledWith("layout.update_all_error", {
      richColors: true,
    });
  });
});
