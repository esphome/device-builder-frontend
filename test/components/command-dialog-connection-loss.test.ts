/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";

import "../_mock-webawesome.js";

import type { FirmwareJob } from "../../src/api/types/firmware-jobs.js";
import { ESPHomeCommandDialog } from "../../src/components/command-dialog.js";
import {
  followJob,
  startValidateStream,
  stopCommand,
} from "../../src/components/command-dialog/commands.js";
import { makeFirmwareJob } from "../_make-firmware-job.js";
import {
  type StreamCbs,
  flushResume,
  makeCommandDialogHost,
} from "./_command-dialog-host.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const jobsOf = (...jobs: FirmwareJob[]) =>
  new Map(jobs.map((j) => [j.job_id, j] as const));

describe("command-dialog follow connection loss", () => {
  it("keeps the job, stays running, and re-follows with a reset log", async () => {
    const { host, follows, bumpGeneration } = makeCommandDialogHost(
      jobsOf(makeFirmwareJob({ job_id: "j1" }))
    );
    (host as any)._jobId = "j1";
    followJob(host, "j1");
    (host as any)._log.append(["partial output"]);

    follows["j1"].onConnectionLost!();
    expect((host as any)._jobId).toBe("j1");
    expect((host as any)._state).toBe("running");
    expect((host as any)._streamId).toBe("");

    bumpGeneration(); // the reconnect happened
    await flushResume();
    expect((host as any)._streamId).toBe("stream-2");
    expect((host as any)._log.lines).toEqual([]);
  });

  it("gives up with a terminal state when the send was refused with no reconnect", async () => {
    const { host, follows } = makeCommandDialogHost(
      jobsOf(makeFirmwareJob({ job_id: "j1" }))
    );
    (host as any)._jobId = "j1";
    followJob(host, "j1");

    follows["j1"].onConnectionLost!();
    // No bumpGeneration: ready resolved without a new socket.
    await flushResume();
    expect((host as any)._streamId).toBe("");
    expect((host as any)._state).toBe("error");
    expect((host as any)._statusMessage).toBe("command.connection_interrupted");
    expect((host as any)._connectionInterrupted).toBe(true);
    expect((host as any)._jobId).toBe("");
  });

  it("does not re-follow when the user stopped during the outage", async () => {
    const { host, follows, bumpGeneration } = makeCommandDialogHost(
      jobsOf(makeFirmwareJob({ job_id: "j1" }))
    );
    (host as any)._jobId = "j1";
    followJob(host, "j1");

    follows["j1"].onConnectionLost!();
    (host as any)._jobId = ""; // stopCommand during the outage
    bumpGeneration();

    await flushResume();
    expect((host as any)._streamId).toBe("");
  });

  it("does not re-follow onto a dialog closed during the outage", async () => {
    // close()/_onDialogHide flip _open without clearing _jobId, so the
    // open check is the guard that covers dismissal.
    const { host, follows, bumpGeneration } = makeCommandDialogHost(
      jobsOf(makeFirmwareJob({ job_id: "j1" }))
    );
    (host as any)._jobId = "j1";
    followJob(host, "j1");

    follows["j1"].onConnectionLost!();
    (host as any)._open = false;
    bumpGeneration();

    await flushResume();
    expect((host as any)._streamId).toBe("");
    expect((host as any)._jobId).toBe("j1");
  });

  it("Stop is a no-op while disconnected so it can't claim a false stop", () => {
    const firmwareCancel = vi.fn();
    const { host } = makeCommandDialogHost(jobsOf(makeFirmwareJob({ job_id: "j1" })), {
      firmwareCancel,
    });
    (host as any)._jobId = "j1";
    (host as any)._apiConnected = false;
    stopCommand(host);
    expect(firmwareCancel).not.toHaveBeenCalled();
    expect((host as any)._state).toBe("running");
    expect((host as any)._jobId).toBe("j1");
  });

  it("does not re-follow when something already reattached", async () => {
    const { host, follows, bumpGeneration } = makeCommandDialogHost(
      jobsOf(makeFirmwareJob({ job_id: "j1" }))
    );
    (host as any)._jobId = "j1";
    followJob(host, "j1");

    follows["j1"].onConnectionLost!();
    followJob(host, "j1"); // a manual reattach (stream-2) wins
    bumpGeneration();

    await flushResume();
    expect((host as any)._streamId).toBe("stream-2");
  });
});

describe("command-dialog reconnecting banner overlay", () => {
  it("overrides the terminal only while a run is active", async () => {
    const el = new ESPHomeCommandDialog();
    (el as any)._api = { firmwareFollowJob: () => "s1", ready: Promise.resolve() };
    document.body.appendChild(el);
    (el as any)._open = true;
    (el as any)._state = "running";
    (el as any)._apiConnected = false;
    await el.updateComplete;
    const terminal = el.shadowRoot!.querySelector("esphome-process-terminal") as any;
    expect(terminal.state).toBe("error");
    expect(terminal.statusMessage).toBe("layout.reconnecting");
    // The stream is paused, so the pulsing dot pauses with it.
    expect(terminal.hasAttribute("streaming")).toBe(false);

    (el as any)._apiConnected = true;
    await el.updateComplete;
    expect(terminal.state).toBe("running");

    (el as any)._state = "error";
    (el as any)._statusMessage = "command.install_failed";
    (el as any)._apiConnected = false;
    await el.updateComplete;
    expect(terminal.state).toBe("error");
    expect(terminal.statusMessage).toBe("command.install_failed");
  });
});

describe("command-dialog validate connection loss", () => {
  it("shows the localized interruption message instead of raw prose", () => {
    let cbs!: StreamCbs;
    const validate = vi.fn((_c: string, callbacks: StreamCbs) => {
      cbs = callbacks;
      return "v1";
    });
    const { host } = makeCommandDialogHost(jobsOf(), { validate });
    (host as any)._commandType = "validate";
    (host as any)._showSecrets = false;
    startValidateStream(host);

    cbs.onConnectionLost!();
    expect((host as any)._state).toBe("error");
    expect((host as any)._statusMessage).toBe("command.connection_interrupted");
    expect((host as any)._streamId).toBe("");
  });
});
