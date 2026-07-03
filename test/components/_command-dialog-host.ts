// Shared fake ESPHomeCommandDialog host for the chain-follow tests
// (install + rename) so the mirrored follow-path fields live in one place.
import type { FirmwareJob } from "../../src/api/types/firmware-jobs.js";
import { JobStatus } from "../../src/api/types/firmware-jobs.js";
import type { ESPHomeCommandDialog } from "../../src/components/command-dialog.js";

export interface StreamCbs {
  onOutput: (line: string) => void;
  onResult: (data: unknown) => void;
  onError: (error: string) => void;
}

export function makeCommandDialogHost(
  jobs: Map<string, FirmwareJob>,
  apiExtra: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {}
) {
  const follows: Record<string, StreamCbs> = {};
  let flipped = false;
  let streamSeq = 0;
  const host = {
    _api: {
      firmwareFollowJob: (jobId: string, cbs: StreamCbs): string => {
        follows[jobId] = cbs;
        return `stream-${++streamSeq}`;
      },
      ...apiExtra,
    },
    _jobs: jobs,
    _commandType: "install",
    _jobId: "",
    _jobStatus: JobStatus.RUNNING,
    _state: "running",
    _statusMessage: "",
    _streamId: "",
    _switchingToLocal: false,
    configuration: "kitchen.yaml",
    name: "kitchen",
    _port: "OTA",
    _lines: [] as string[],
    _showLogsAfterInstall: true,
    _userStopped: false,
    _failedDuringValidate: false,
    _compileMissingDependent: false,
    _localize: (key: string) => key,
    _flipToLogs: () => {
      flipped = true;
    },
    _flushPendingLines: () => {},
    _resetPendingLines: () => {},
    _enqueueLine: () => {},
    ...overrides,
  };
  return {
    host: host as unknown as ESPHomeCommandDialog,
    follows,
    flipped: () => flipped,
  };
}
