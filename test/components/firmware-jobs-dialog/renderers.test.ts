// @vitest-environment happy-dom
//
// Tests for renderSourceLine — the per-job "source" line in the firmware-jobs
// dialog. Mounts the Lit TemplateResult into a happy-dom container (repo idiom)
// and asserts on the produced DOM.

import { nothing } from "lit";
import { describe, expect, it } from "vitest";

import { JobSource, JobType } from "../../../src/api/types/firmware-jobs.js";
import {
  renderGroups,
  renderSourceLine,
} from "../../../src/components/firmware-jobs-dialog/renderers.js";
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
  it("labels a deferred-install compile as the Install its dialog claims to be", () => {
    const job = makeFirmwareJob({
      job_type: JobType.COMPILE,
      is_deferred_install: true,
    });
    const el = renderInto(renderGroups(groupsHost() as never, [job], []));
    expect(el.textContent).toContain("firmware_jobs.type_install");
    expect(el.textContent).not.toContain("firmware_jobs.type_compile");
  });

  it("keeps a plain compile labeled Compile", () => {
    const job = makeFirmwareJob({ job_type: JobType.COMPILE });
    const el = renderInto(renderGroups(groupsHost() as never, [job], []));
    expect(el.textContent).toContain("firmware_jobs.type_compile");
  });
});
