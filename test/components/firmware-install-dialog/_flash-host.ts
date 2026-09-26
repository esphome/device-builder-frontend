import { vi } from "vitest";

import { identityLocalize } from "../../_dom.js";
import { fakeLogBuffer } from "../../_fake-host.js";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import type { FirmwareBinary } from "../../../src/api/types/firmware-jobs.js";
import type { ESPHomeFirmwareInstallDialog } from "../../../src/components/firmware-install-dialog.js";

export const bin = (file: string, type?: string): FirmwareBinary => ({
  file,
  title: file,
  type,
});

/**
 * The install dialog as the compile-first browser flashers see it: an API
 * whose compile completes at once, a device, the step and status fields, and
 * a real `_fail`. `extra` adds what a flow needs beyond that (the logs port).
 */
export function makeFlashHost<E extends object>(
  device: ConfiguredDevice,
  opts: { binaries: FirmwareBinary[]; downloadBytes: ArrayBuffer },
  extra: E = {} as E
) {
  const api = {
    firmwareCompile: vi.fn().mockResolvedValue({ job_id: "j", source: "local" }),
    firmwareFollowJob: vi.fn((_id: string, cbs: { onResult: (d: unknown) => void }) => {
      cbs.onResult({ status: "completed" });
      return "stream";
    }),
    firmwareGetBinaries: vi.fn().mockResolvedValue(opts.binaries),
    firmwareDownloadBytes: vi.fn().mockResolvedValue(opts.downloadBytes),
    stopStream: vi.fn().mockResolvedValue({ cancelled: true }),
  } as unknown as ESPHomeAPI;
  return {
    _api: api,
    _device: device as ConfiguredDevice | null,
    _localize: identityLocalize,
    _step: "queued",
    _statusMessage: "",
    _errorMessage: "",
    _log: fakeLogBuffer(),
    _jobId: "",
    _streamId: "",
    _compileReject: null,
    _jobSource: 0,
    _jobSourceLabel: "",
    _failureKind: null,
    _binaries: [] as FirmwareBinary[],
    _flashBusy: false,
    _flashAbort: null as AbortController | null,
    _flashPercent: 0,
    _flashImage: null as unknown,
    _fail(title: string, detail = "") {
      this._step = "error";
      this._statusMessage = title;
      this._errorMessage = detail;
    },
    ...extra,
  };
}

export const asHost = (h: object) => h as unknown as ESPHomeFirmwareInstallDialog;
