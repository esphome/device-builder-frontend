/**
 * Pins that the pair-dialog catch-all error paths surface the backend's
 * detail text instead of only pointing at the dashboard logs.
 */
import { describe, expect, it } from "vitest";
import { APIError } from "../../../src/api/api-error.js";
import { ErrorCode } from "../../../src/api/types/protocol.js";
import type { ESPHomePairBuildServerDialog } from "../../../src/components/pair-build-server-dialog.js";
import {
  previewErrorMessage,
  requestErrorMessage,
} from "../../../src/components/pair-build-server-dialog/actions.js";
import { identityLocalize } from "../../_dom.js";

const host = {
  _localize: identityLocalize,
  _hostname: "buildbox.local",
  _port: "6055",
} as unknown as ESPHomePairBuildServerDialog;

describe("previewErrorMessage", () => {
  it("keeps the specific message for UNAVAILABLE", () => {
    const msg = previewErrorMessage(host, new APIError(ErrorCode.UNAVAILABLE, "down"));
    expect(msg).toBe("settings.pair_build_server_preview_unreachable");
  });

  it("surfaces the backend detail for an unmapped error code", () => {
    const msg = previewErrorMessage(
      host,
      new APIError(ErrorCode.INTERNAL_ERROR, "identity not loaded yet")
    );
    expect(msg).toBe("identity not loaded yet");
  });

  it("falls back to the generic message when there is no detail", () => {
    const msg = previewErrorMessage(host, new APIError(ErrorCode.INTERNAL_ERROR, ""));
    expect(msg).toBe("settings.pair_build_server_preview_failed");
  });
});

describe("requestErrorMessage", () => {
  it("surfaces the backend detail for an unmapped error code", () => {
    const msg = requestErrorMessage(
      host,
      new APIError(ErrorCode.INTERNAL_ERROR, "peer-link handshake timed out")
    );
    expect(msg).toBe("peer-link handshake timed out");
  });

  it("falls back to the generic message when there is no detail", () => {
    const msg = requestErrorMessage(host, new APIError(ErrorCode.INTERNAL_ERROR, ""));
    expect(msg).toBe("settings.pair_build_server_request_failed");
  });
});
