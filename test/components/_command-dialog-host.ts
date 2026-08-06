// Shared fake ESPHomeCommandDialog host for the chain-follow tests
// (install + rename) so the mirrored follow-path fields live in one place.

import { flushMicrotasks } from "../_dom.js";
import { fakeLogBuffer } from "../_fake-host.js";
import type { ConfiguredDevice } from "../../src/api/types/devices.js";
import type { FirmwareJob } from "../../src/api/types/firmware-jobs.js";
import { JobStatus } from "../../src/api/types/firmware-jobs.js";
import type { ESPHomeCommandDialog } from "../../src/components/command-dialog.js";

export interface StreamCbs {
  onOutput: (line: string) => void;
  onResult: (data: unknown) => void;
  onError: (error: string) => void;
  onConnectionLost?: () => void;
}

/** Fake of the resumable-API surface resume-follow.ts consumes: ready
 *  pre-resolved, generation static until bumpGeneration models the
 *  reconnect (an unbumped resume is the refused-send give-up path). */
export function makeReconnectApi(): {
  ready: Promise<void>;
  readonly connectionGeneration: number;
  bumpGeneration: () => void;
} {
  let generation = 0;
  return {
    ready: Promise.resolve(),
    get connectionGeneration(): number {
      return generation;
    },
    bumpGeneration: () => {
      generation += 1;
    },
  };
}

/** Drain the pre-resolved ready's .then chain. */
export const flushResume = (): Promise<void> => flushMicrotasks(4);

export function makeCommandDialogHost(
  jobs: Map<string, FirmwareJob>,
  apiExtra: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {}
) {
  const follows: Record<string, StreamCbs> = {};
  let flipped = false;
  let streamSeq = 0;
  const reconnectApi = makeReconnectApi();
  const host = {
    // Assigned onto the reconnect fake so its generation getter survives
    // (a spread would snapshot the getter's value).
    _api: Object.assign(reconnectApi, {
      firmwareFollowJob: (jobId: string, cbs: StreamCbs): string => {
        follows[jobId] = cbs;
        return `stream-${++streamSeq}`;
      },
      ...apiExtra,
    }),
    _apiConnected: true,
    _jobs: jobs,
    _commandType: "install",
    _open: true,
    _jobId: "",
    _timerJobId: "",
    _awaitingWakeAfter: "",
    _timer: { reset: () => {} },
    _closeTimerDetail: () => {},
    _jobStatus: JobStatus.RUNNING,
    _state: "running",
    _statusMessage: "",
    _streamId: "",
    _switchingToLocal: false,
    configuration: "kitchen.yaml",
    name: "kitchen",
    _devices: [] as ConfiguredDevice[],
    _port: "OTA",
    _log: fakeLogBuffer(),
    _showLogsAfterInstall: true,
    _userStopped: false,
    _failedDuringValidate: false,
    _compileMissingDependent: false,
    _localize: (key: string) => key,
    _resetAnsiLogScroll: () => {},
    _flipToLogs: () => {
      flipped = true;
    },
    _enqueueLine(line: string) {
      this._log.enqueue(line);
    },
    ...overrides,
  };
  return {
    host: host as unknown as ESPHomeCommandDialog,
    follows,
    flipped: () => flipped,
    bumpGeneration: reconnectApi.bumpGeneration,
  };
}
