/**
 * @vitest-environment happy-dom
 *
 * The command dialog is a reused singleton: clicking a job in firmware-tasks
 * reattaches via the public followJob without going through open()/startCommand.
 * That path must clear per-session flags, else a prior install's missing-upload
 * failure leaves _compileMissingDependent set and suppresses the clean/reset hint
 * on a subsequently-replayed real build failure. Pin the reset here.
 */
import { describe, expect, it } from "vitest";
import { type FirmwareJob, JobType } from "../../src/api/types/firmware-jobs.js";
import { ESPHomeCommandDialog } from "../../src/components/command-dialog.js";
import { makeFirmwareJob } from "../_make-firmware-job.js";

describe("command-dialog public followJob state reset", () => {
  it("clears a stale _compileMissingDependent on reattach", () => {
    const el = new ESPHomeCommandDialog() as unknown as {
      _compileMissingDependent: boolean;
      _streamId: string;
      _api: { firmwareFollowJob: () => string };
      followJob: (job: FirmwareJob, displayName: string, commandType?: string) => void;
    };
    // Left over from a prior install whose compile succeeded but found no dependent flash.
    el._compileMissingDependent = true;
    el._streamId = "";
    el._api = { firmwareFollowJob: () => "stream-1" } as never;

    el.followJob(makeFirmwareJob({ job_id: "j1", job_type: JobType.COMPILE }), "device");

    expect(el._compileMissingDependent).toBe(false);
  });
});
