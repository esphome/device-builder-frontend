// Pins the approve/reject toast mapping: success, the NOT_FOUND
// "already gone" downgrade, detail-carrying failures, and generic errors.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/util/notify.js", () => ({
  notify: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

import { APIError } from "../../src/api/api-error.js";
import type { ESPHomeAPI } from "../../src/api/esphome-api.js";
import { ErrorCode } from "../../src/api/types/protocol.js";
import { notify } from "../../src/util/notify.js";
import {
  approvePeerRequest,
  rejectPeerRequest,
} from "../../src/util/peer-pairing-actions.js";
import { identityLocalize } from "../_dom.js";

function makeApi(overrides: Partial<Record<string, unknown>> = {}): ESPHomeAPI {
  return {
    approveRemoteBuildPeer: vi.fn().mockResolvedValue({}),
    removeRemoteBuildPeer: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as ESPHomeAPI;
}

describe("peer-pairing-actions", () => {
  beforeEach(() => {
    vi.mocked(notify.success).mockClear();
    vi.mocked(notify.warning).mockClear();
    vi.mocked(notify.error).mockClear();
  });

  it("approve success toasts the success key", async () => {
    const api = makeApi();
    await approvePeerRequest(api, identityLocalize, "dash-1");
    expect(api.approveRemoteBuildPeer).toHaveBeenCalledWith({
      dashboard_id: "dash-1",
    });
    expect(notify.success).toHaveBeenCalledWith(
      "settings.build_server_peer_approve_success"
    );
  });

  it("approve NOT_FOUND downgrades to the already-gone warning", async () => {
    const api = makeApi({
      approveRemoteBuildPeer: vi
        .fn()
        .mockRejectedValue(new APIError(ErrorCode.NOT_FOUND, "gone")),
    });
    await approvePeerRequest(api, identityLocalize, "dash-1");
    expect(notify.warning).toHaveBeenCalledWith(
      "settings.build_server_peer_approve_already_gone"
    );
    expect(notify.error).not.toHaveBeenCalled();
  });

  it("reject failure with details uses the detail key", async () => {
    const api = makeApi({
      removeRemoteBuildPeer: vi
        .fn()
        .mockRejectedValue(new APIError("internal_error", "disk full")),
    });
    await rejectPeerRequest(api, identityLocalize, "dash-1");
    expect(notify.error).toHaveBeenCalledWith(
      "settings.build_server_peer_reject_failed_detail"
    );
  });

  it("non-API errors fall back to the generic failure key", async () => {
    const api = makeApi({
      removeRemoteBuildPeer: vi.fn().mockRejectedValue(new Error("boom")),
    });
    await rejectPeerRequest(api, identityLocalize, "dash-1");
    expect(notify.error).toHaveBeenCalledWith("settings.build_server_peer_reject_failed");
  });
});
