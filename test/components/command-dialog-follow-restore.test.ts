/**
 * @vitest-environment happy-dom
 *
 * The public followJob attaches to an install chain via its COMPILE head, but
 * the flash target lives on the dependent UPLOAD — port and bootloader must
 * restore from the dependent so a "Build locally instead" resubmit keeps the
 * typed address and keeps flashing the bootloader.
 */
import { describe, expect, it } from "vitest";
import { type FirmwareJob, JobType } from "../../src/api/types/firmware-jobs.js";
import { ESPHomeCommandDialog } from "../../src/components/command-dialog.js";
import { makeFirmwareJob } from "../_make-firmware-job.js";

interface Harness {
  _port: string;
  _bootloader: boolean;
  _jobs: Map<string, FirmwareJob>;
  _streamId: string;
  _api: { firmwareFollowJob: () => string };
  followJob: (job: FirmwareJob, displayName: string) => void;
}

function mount(jobs: FirmwareJob[]): Harness {
  const el = new ESPHomeCommandDialog() as unknown as Harness;
  el._jobs = new Map(jobs.map((j) => [j.job_id, j]));
  el._streamId = "";
  el._api = { firmwareFollowJob: () => "stream-1" } as never;
  return el;
}

const chain = (upload: Partial<FirmwareJob>): FirmwareJob[] => [
  makeFirmwareJob({ job_id: "c1", job_type: JobType.COMPILE, port: "" }),
  makeFirmwareJob({
    job_id: "u1",
    job_type: JobType.UPLOAD,
    depends_on: "c1",
    ...upload,
  }),
];

describe("command-dialog followJob restores flash target from the chain", () => {
  it("restores bootloader off the dependent upload of a compile head", () => {
    const jobs = chain({ port: "OTA", flash_bootloader: true });
    const el = mount(jobs);
    el.followJob(jobs[0], "device");
    expect(el._bootloader).toBe(true);
    expect(el._port).toBe("OTA");
  });

  it("restores an explicit target address off the dependent upload", () => {
    const jobs = chain({ port: "192.168.1.42" });
    const el = mount(jobs);
    el.followJob(jobs[0], "device");
    expect(el._port).toBe("192.168.1.42");
    expect(el._bootloader).toBe(false);
  });

  it("defaults for a plain compile with no dependent", () => {
    const compile = makeFirmwareJob({
      job_id: "c1",
      job_type: JobType.COMPILE,
      port: "",
    });
    const el = mount([compile]);
    el.followJob(compile, "device");
    expect(el._port).toBe("OTA");
    expect(el._bootloader).toBe(false);
  });

  it("reads a directly-followed upload's own flags", () => {
    const upload = makeFirmwareJob({
      job_id: "u1",
      job_type: JobType.UPLOAD,
      port: "OTA",
      flash_bootloader: true,
    });
    const el = mount([upload]);
    el.followJob(upload, "device");
    expect(el._bootloader).toBe(true);
  });
});
