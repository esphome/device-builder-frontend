// @vitest-environment happy-dom
//
// Tests for renderSourceLine — the per-job "source" line in the shared
// firmware-jobs list. Mounts the Lit TemplateResult into a happy-dom container
// (repo idiom) and asserts on the produced DOM.

import { nothing } from "lit";
import { describe, expect, it } from "vitest";

import { JobSource, JobStatus, JobType } from "../../../src/api/types/firmware-jobs.js";
import {
  bucketJobs,
  renderGroups,
  renderSourceLine,
} from "../../../src/components/shared/firmware-jobs-list.js";
import { identityLocalize, renderInto } from "../../_dom.js";
import { makeFirmwareJob } from "../../_make-firmware-job.js";

// renderSourceLine only reads host._localize; a key-echoing stub lets us assert
// which localization key the branch picked.
function host(): { _localize: (key: string) => string } {
  return { _localize: identityLocalize };
}

describe("renderSourceLine", () => {
  it("renders the waiting hint for a REMOTE_PENDING compile", () => {
    const job = makeFirmwareJob({ source: JobSource.REMOTE_PENDING });
    const el = renderInto(renderSourceLine(host() as never, job));
    expect(el.textContent).toContain("firmware_jobs.waiting_for_build_server");
  });

  it("renders 'building on' once a REMOTE compile is bound to a server", () => {
    const job = makeFirmwareJob({
      source: JobSource.REMOTE,
      source_label: "desktop",
    });
    const el = renderInto(renderSourceLine(host() as never, job));
    expect(el.textContent).toContain("firmware_jobs.building_on");
    expect(el.textContent).not.toContain("waiting_for_build_server");
  });

  it("renders nothing for a plain LOCAL compile", () => {
    const job = makeFirmwareJob({ source: JobSource.LOCAL });
    expect(renderSourceLine(host() as never, job)).toBe(nothing);
  });
});

// renderGroups reads _jobDisplayName / _localize / _openJob / _now off the host.
function groupsHost() {
  return {
    _localize: identityLocalize,
    _jobDisplayName: (job: { configuration: string }) => job.configuration,
    _openJob: () => {},
    _now: new Date("2026-01-01T00:01:00Z").getTime(),
  };
}

describe("renderJob type label", () => {
  it("labels a deferred-install compile as an offline compile", () => {
    const job = makeFirmwareJob({
      job_type: JobType.COMPILE,
      is_deferred_install: true,
    });
    const el = renderInto(renderGroups(groupsHost() as never, [job], []));

    expect(el.textContent).toContain("firmware_jobs.type_offline_compile");

    expect(el.textContent).not.toContain("firmware_jobs.type_compile");
    expect(el.textContent).not.toContain("firmware_jobs.type_install");
  });

  it("keeps a plain compile labeled Compile", () => {
    const job = makeFirmwareJob({ job_type: JobType.COMPILE });
    const el = renderInto(renderGroups(groupsHost() as never, [job], []));
    expect(el.textContent).toContain("firmware_jobs.type_compile");
  });

  it("labels a standard install as Install", () => {
    const job = makeFirmwareJob({ job_type: JobType.INSTALL });
    const el = renderInto(renderGroups(groupsHost() as never, [job], []));
    expect(el.textContent).toContain("firmware_jobs.type_install");
  });

  it("keeps Upload on a failed upload converted offline", () => {
    const job = makeFirmwareJob({
      job_type: JobType.UPLOAD,
      status: JobStatus.FAILED,
      is_deferred_install: true,
    });
    const el = renderInto(renderGroups(groupsHost() as never, [job], []));
    expect(el.textContent).toContain("firmware_jobs.type_upload");
    expect(el.textContent).not.toContain("firmware_jobs.type_offline_compile");
  });
});

describe("bucketJobs", () => {
  it("splits and orders running → queued, terminal newest-first", () => {
    const running = makeFirmwareJob({
      job_id: "r",
      status: JobStatus.RUNNING,
      created_at: "2026-01-01T00:05:00Z",
    });
    const queued = makeFirmwareJob({
      job_id: "q",
      status: JobStatus.QUEUED,
      created_at: "2026-01-01T00:01:00Z",
    });
    const doneOld = makeFirmwareJob({
      job_id: "d1",
      status: JobStatus.COMPLETED,
      completed_at: "2026-01-01T00:02:00Z",
    });
    const doneNew = makeFirmwareJob({
      job_id: "d2",
      status: JobStatus.FAILED,
      completed_at: "2026-01-01T00:04:00Z",
    });
    const { active, terminal } = bucketJobs(
      new Map([
        ["d1", doneOld],
        ["q", queued],
        ["d2", doneNew],
        ["r", running],
      ])
    );
    expect(active.map((j) => j.job_id)).toEqual(["r", "q"]);
    expect(terminal.map((j) => j.job_id)).toEqual(["d2", "d1"]);
  });
});
