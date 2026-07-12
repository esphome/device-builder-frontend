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
import {
  type CommandType,
  ESPHomeCommandDialog,
} from "../../src/components/command-dialog.js";
import { markCompileStarted } from "../../src/util/compile-timing.js";
import { makeFirmwareJob } from "../_make-firmware-job.js";

interface Harness {
  _port: string;
  _bootloader: boolean;
  _jobs: Map<string, FirmwareJob>;
  _streamId: string;
  _api: { firmwareFollowJob: () => string };
  _compileStartedAt: number | null;
  _compileEndedAt: number | null;
  _jobId: string;
  _timerJobId: string;
  _commandType: CommandType;
  _now: number;
  readonly _totalRunElapsedMs: number | null;
  readonly _compileDetailMs: number | null;
  readonly _isRunFrozen: boolean;
  readonly _showRunTimer: boolean;
  _showTimerDetail: boolean;
  _toggleTimerDetail: () => void;
  _onOutsideTimerClick: (e: MouseEvent) => void;
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

describe("command-dialog followJob restores the compile timer across reopen", () => {
  it("prefers the backend compile timestamps (survive a full reload)", () => {
    const job = makeFirmwareJob({
      job_id: "be1",
      job_type: JobType.COMPILE,
      compile_started_at: "2026-01-01T00:00:10Z",
      compile_ended_at: "2026-01-01T00:02:30Z",
    });
    const el = mount([job]);
    el.followJob(job, "device");
    expect(el._compileStartedAt).toBe(Date.parse("2026-01-01T00:00:10Z"));
    expect(el._compileEndedAt).toBe(Date.parse("2026-01-01T00:02:30Z"));
  });

  it("falls back to the in-memory store when the backend fields are absent", () => {
    // Old-backend / old-job shape: no compile_* fields on the wire.
    const job = makeFirmwareJob({ job_id: "store1", job_type: JobType.COMPILE });
    delete job.compile_started_at;
    delete job.compile_ended_at;
    markCompileStarted("store1", 12345);
    const el = mount([job]);
    el.followJob(job, "device");
    expect(el._compileStartedAt).toBe(12345);
    expect(el._compileEndedAt).toBeNull();
  });

  it("degrades to no timing when neither backend nor store has it", () => {
    const job = makeFirmwareJob({ job_id: "none1", job_type: JobType.COMPILE });
    delete job.compile_started_at;
    delete job.compile_ended_at;
    const el = mount([job]);
    el.followJob(job, "device");
    expect(el._compileStartedAt).toBeNull();
    expect(el._compileEndedAt).toBeNull();
  });
});

describe("command-dialog total run time (for the timer detail popover)", () => {
  it("spans a running job's start to now", () => {
    const job = makeFirmwareJob({
      job_id: "run1",
      job_type: JobType.COMPILE,
      started_at: "2026-01-01T00:00:00Z",
      completed_at: null,
    });
    const el = mount([job]);
    el._timerJobId = "run1";
    el._now = Date.parse("2026-01-01T00:00:29Z");
    expect(el._totalRunElapsedMs).toBe(29_000);
  });

  it("freezes a finished job at start-to-completion", () => {
    const job = makeFirmwareJob({
      job_id: "run2",
      job_type: JobType.COMPILE,
      started_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T00:00:29Z",
    });
    const el = mount([job]);
    el._timerJobId = "run2";
    el._now = Date.parse("2026-01-01T01:00:00Z");
    expect(el._totalRunElapsedMs).toBe(29_000);
  });

  it("is null before the job starts running", () => {
    const job = makeFirmwareJob({
      job_id: "run3",
      job_type: JobType.COMPILE,
      started_at: null,
    });
    const el = mount([job]);
    el._timerJobId = "run3";
    expect(el._totalRunElapsedMs).toBeNull();
  });

  it("survives the stream clearing _jobId after an install's compile", () => {
    const job = makeFirmwareJob({
      job_id: "run4",
      job_type: JobType.COMPILE,
      started_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T00:00:29Z",
    });
    const el = mount([job]);
    el._timerJobId = "run4";
    el._jobId = ""; // stream ended; the flash then failed
    el._now = Date.parse("2026-01-01T00:01:30Z");
    expect(el._totalRunElapsedMs).toBe(29_000);
  });

  it("stays visible (total non-null) for a completed/queued install", () => {
    const job = makeFirmwareJob({
      job_id: "run5",
      job_type: JobType.COMPILE,
      started_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T00:00:50Z",
    });
    const el = mount([job]);
    el._timerJobId = "run5";
    expect(el._isRunFrozen).toBe(true);
    expect(el._totalRunElapsedMs).not.toBeNull();
  });
});

describe("command-dialog compile detail (total never shorter than compile)", () => {
  it("derives compile time from the backend stamps, bounded by the run", () => {
    const job = makeFirmwareJob({
      job_id: "d1",
      job_type: JobType.COMPILE,
      started_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T00:00:50Z",
      compile_started_at: "2026-01-01T00:00:12Z",
      compile_ended_at: "2026-01-01T00:00:45Z",
    });
    const el = mount([job]);
    el._timerJobId = "d1";
    el._now = Date.parse("2026-01-01T01:00:00Z");
    expect(el._compileDetailMs).toBe(33_000);
    // The invariant the redesign guarantees: total >= compile.
    expect(el._totalRunElapsedMs).toBe(50_000);
    expect(el._totalRunElapsedMs!).toBeGreaterThanOrEqual(el._compileDetailMs!);
  });

  it("falls back to live frontend detection before the backend stamps land", () => {
    const job = makeFirmwareJob({ job_id: "d2", job_type: JobType.COMPILE });
    delete job.compile_started_at;
    delete job.compile_ended_at;
    const el = mount([job]);
    el._timerJobId = "d2";
    el._compileStartedAt = 1000;
    el._compileEndedAt = 6000;
    expect(el._compileDetailMs).toBe(5000);
  });
});

describe("command-dialog run timer visibility", () => {
  const timedJob = (id: string, seconds: number): FirmwareJob =>
    makeFirmwareJob({
      job_id: id,
      job_type: JobType.COMPILE,
      started_at: "2026-01-01T00:00:00Z",
      completed_at: `2026-01-01T00:00:${String(seconds).padStart(2, "0")}Z`,
    });

  it("shows for a build command with a real total", () => {
    const el = mount([timedJob("t1", 7)]);
    el._timerJobId = "t1";
    el._commandType = "compile";
    expect(el._showRunTimer).toBe(true);
  });

  it("hides for clean and validate (not builds)", () => {
    const el = mount([timedJob("t2", 7)]);
    el._timerJobId = "t2";
    el._commandType = "clean";
    expect(el._showRunTimer).toBe(false);
    el._commandType = "validate";
    expect(el._showRunTimer).toBe(false);
  });

  it("degrades (no bare 0s) for a sub-second or untimed job", () => {
    const el = mount([timedJob("t3", 0)]); // started == completed → 0ms
    el._timerJobId = "t3";
    el._commandType = "compile";
    expect(el._showRunTimer).toBe(false);

    const untimed = makeFirmwareJob({ job_id: "t4", job_type: JobType.COMPILE });
    untimed.started_at = null;
    const el2 = mount([untimed]);
    el2._timerJobId = "t4";
    el2._commandType = "compile";
    expect(el2._showRunTimer).toBe(false);
  });
});

describe("command-dialog timer detail popover dismissal", () => {
  it("toggles open then closed", () => {
    const el = mount([]);
    el._toggleTimerDetail();
    expect(el._showTimerDetail).toBe(true);
    el._toggleTimerDetail();
    expect(el._showTimerDetail).toBe(false);
  });

  it("closes on a click outside the timer", () => {
    const el = mount([]);
    el._toggleTimerDetail();
    expect(el._showTimerDetail).toBe(true);
    // A click whose composed path doesn't include the timer wrap closes it.
    el._onOutsideTimerClick({ composedPath: () => [] } as unknown as MouseEvent);
    expect(el._showTimerDetail).toBe(false);
  });
});
