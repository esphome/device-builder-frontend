/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { JobStatus } from "../../../src/api/types/firmware-jobs.js";
import type { ESPHomeFirmwareInstallDialog } from "../../../src/components/firmware-install-dialog.js";
import {
  compileAndWait,
  waitForRunningJob,
} from "../../../src/components/firmware-install-dialog/install-flow.js";
import {
  cardState,
  cardStatusMessage,
} from "../../../src/components/firmware-install-dialog/renderers.js";
import { fakeLogBuffer } from "../../_fake-host.js";
import { flushMicrotasks, identityLocalize } from "../../_dom.js";
import type { StreamCbs } from "../_command-dialog-host.js";

function makeHost() {
  const follows: StreamCbs[] = [];
  let generation = 0;
  const host = {
    _api: {
      firmwareCompile: vi.fn(async () => ({
        job_id: "j1",
        source: "local",
        source_label: "",
        source_pin_sha256: "",
      })),
      firmwareFollowJob: vi.fn((_jobId: string, cbs: StreamCbs): string => {
        follows.push(cbs);
        return `stream-${follows.length}`;
      }),
      ready: Promise.resolve(),
      // Bumps per read: ready is pre-resolved here, so model the
      // reconnect as having happened by the time a resume rechecks.
      get connectionGeneration(): number {
        return ++generation;
      },
    },
    _jobId: "",
    _streamId: "",
    _compileReject: null as (() => void) | null,
    _step: "queued",
    _statusMessage: "",
    _errorMessage: "",
    _failureKind: null,
    _jobSource: null,
    _jobSourceLabel: "",
    _jobSourcePin: "",
    _timer: { noteLine: () => {} },
    _log: fakeLogBuffer(),
    _localize: identityLocalize,
    _fail: vi.fn(),
  };
  return { host: host as unknown as ESPHomeFirmwareInstallDialog, follows, raw: host };
}

const flushResume = () => flushMicrotasks(4);

describe("compileAndWait connection loss", () => {
  it("keeps the promise pending, re-follows, and the replayed result resolves", async () => {
    const { host, follows, raw } = makeHost();
    const pending = compileAndWait(host, "x.yaml");
    await Promise.resolve(); // firmwareCompile resolves, first follow attaches
    expect(follows).toHaveLength(1);
    raw._log.append(["partial output"]);

    follows[0].onConnectionLost!();
    expect(raw._jobId).toBe("j1");
    expect(raw._fail).not.toHaveBeenCalled();

    await flushResume();
    expect(follows).toHaveLength(2);
    expect(raw._log.lines).toEqual([]);

    follows[1].onOutput("replayed line");
    follows[1].onResult({ status: JobStatus.COMPLETED });
    await expect(pending).resolves.toBeUndefined();
  });

  it("does not re-follow after a dismissal settled the wait", async () => {
    const { host, follows, raw } = makeHost();
    const pending = compileAndWait(host, "x.yaml");
    await Promise.resolve();

    follows[0].onConnectionLost!();
    // _detachStream during the outage: settles the promise and clears
    // the ownership fields.
    raw._compileReject?.();
    raw._compileReject = null;
    raw._jobId = "";

    await flushResume();
    expect(follows).toHaveLength(1);
    await expect(pending).rejects.toBeUndefined();
  });
});

describe("waitForRunningJob connection loss", () => {
  it("re-follows and resolves from the replayed terminal result", async () => {
    const { host, follows, raw } = makeHost();
    const pending = waitForRunningJob(host, "j9");

    expect(follows).toHaveLength(1);
    follows[0].onConnectionLost!();
    await flushResume();
    expect(follows).toHaveLength(2);

    follows[1].onResult({ status: JobStatus.COMPLETED });
    await expect(pending).resolves.toBe(true);
    expect(raw._fail).not.toHaveBeenCalled();
  });

  it("does not re-follow after a dismissal", async () => {
    const { host, follows, raw } = makeHost();
    const pending = waitForRunningJob(host, "j9");

    follows[0].onConnectionLost!();
    raw._compileReject?.();
    raw._compileReject = null;

    await flushResume();
    expect(follows).toHaveLength(1);
    await expect(pending).resolves.toBe(false);
  });
});

describe("reconnecting banner overlay", () => {
  it("overrides the card only during the follow-backed steps", () => {
    const base = { _localize: identityLocalize, _statusMessage: "Compiling…" };
    const compiling = {
      ...base,
      _apiConnected: false,
      _step: "compiling",
    } as unknown as ESPHomeFirmwareInstallDialog;
    expect(cardState(compiling)).toBe("error");
    expect(cardStatusMessage(compiling)).toBe("layout.reconnecting");

    const flashing = {
      ...base,
      _apiConnected: false,
      _step: "flashing",
    } as unknown as ESPHomeFirmwareInstallDialog;
    expect(cardState(flashing)).toBe("running");
    expect(cardStatusMessage(flashing)).toBe("Compiling…");

    const connected = {
      ...base,
      _apiConnected: true,
      _step: "compiling",
    } as unknown as ESPHomeFirmwareInstallDialog;
    expect(cardState(connected)).toBe("running");
    expect(cardStatusMessage(connected)).toBe("Compiling…");
  });
});
