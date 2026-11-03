/**
 * @vitest-environment happy-dom
 *
 * The history list is costly to render and invisible while the dialog is
 * closed, so it must only exist between open() and the end of the hide.
 */
import { describe, expect, it, vi } from "vitest";

import "../_mock-webawesome.js";
vi.mock("../../src/util/notify.js", () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

import { mount } from "../_dom.js";
import { makeFirmwareJob } from "../_make-firmware-job.js";
import { JobStatus } from "../../src/api/types/firmware-jobs.js";
import { ESPHomeFirmwareJobsDialog } from "../../src/components/firmware-jobs-dialog.js";

describe("firmware-jobs-dialog list mounting", () => {
  it("renders no rows while closed, rows while open, none again after hide", async () => {
    const dialog = new ESPHomeFirmwareJobsDialog();
    dialog._jobs = new Map([
      ["a", makeFirmwareJob({ job_id: "a", status: JobStatus.COMPLETED })],
    ]);
    await mount(dialog);
    const rows = () => dialog.shadowRoot!.querySelectorAll("button.job").length;
    expect(rows()).toBe(0);

    dialog.open();
    await dialog.updateComplete;
    expect(rows()).toBe(1);

    dialog
      .shadowRoot!.querySelector("esphome-base-dialog")!
      .dispatchEvent(new CustomEvent("after-hide"));
    await dialog.updateComplete;
    expect(rows()).toBe(0);
  });
});
