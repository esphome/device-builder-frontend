// Pins the cancel toast mapping: the already-finished races stay
// silent, real failures toast (with detail when the backend sent one).

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
import { cancelFirmwareJob } from "../../src/util/firmware-job-actions.js";
import { notify } from "../../src/util/notify.js";
import { identityLocalize } from "../_dom.js";

function makeApi(firmwareCancel: unknown): ESPHomeAPI {
  return { firmwareCancel } as unknown as ESPHomeAPI;
}

describe("cancelFirmwareJob", () => {
  beforeEach(() => {
    vi.mocked(notify.error).mockClear();
  });

  it("cancels silently on success", async () => {
    const api = makeApi(vi.fn().mockResolvedValue(undefined));
    await cancelFirmwareJob(api, identityLocalize, "job-1");
    expect(api.firmwareCancel).toHaveBeenCalledWith("job-1");
    expect(notify.error).not.toHaveBeenCalled();
  });

  it.each([ErrorCode.NOT_FOUND, ErrorCode.INVALID_ARGS])(
    "swallows the already-finished race (%s)",
    async (code) => {
      const api = makeApi(vi.fn().mockRejectedValue(new APIError(code, "gone")));
      await cancelFirmwareJob(api, identityLocalize, "job-1");
      expect(notify.error).not.toHaveBeenCalled();
    }
  );

  it("toasts the detail key when the backend sent a reason", async () => {
    const api = makeApi(
      vi.fn().mockRejectedValue(new APIError(ErrorCode.INTERNAL_ERROR, "lane wedged"))
    );
    await cancelFirmwareJob(api, identityLocalize, "job-1");
    expect(notify.error).toHaveBeenCalledWith("firmware_jobs.cancel_failed_detail");
  });

  it("toasts the generic key on a reasonless failure", async () => {
    const api = makeApi(vi.fn().mockRejectedValue(new Error("ws dropped")));
    await cancelFirmwareJob(api, identityLocalize, "job-1");
    expect(notify.error).toHaveBeenCalledWith("firmware_jobs.cancel_failed");
  });
});
