// @vitest-environment happy-dom
//
// Tests for renderSourceLine — the per-job "source" line in the firmware-jobs
// dialog. Mounts the Lit TemplateResult into a happy-dom container (repo idiom)
// and asserts on the produced DOM.

import { nothing, render } from "lit";
import { describe, expect, it } from "vitest";

import { JobSource } from "../../../src/api/types/firmware-jobs.js";
import { renderSourceLine } from "../../../src/components/firmware-jobs-dialog/renderers.js";
import { makeFirmwareJob } from "../../_make-firmware-job.js";

// renderSourceLine only reads host._localize; a key-echoing stub lets us assert
// which localization key the branch picked.
function host(): { _localize: (key: string) => string } {
  return { _localize: (key: string) => key };
}

function renderInto(value: unknown): HTMLElement {
  const container = document.createElement("div");
  render(value, container);
  return container;
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
