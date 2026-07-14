/**
 * @vitest-environment happy-dom
 *
 * The card's encryption lock reads the RAW has_pending_changes, while the
 * modified dot reads the mDNS-gated showModified — so an mDNS-dark, hash-pending,
 * encrypted device shows the lock-clock and hides the dot, matching the drawer's
 * raw-flag badge instead of diverging (#1037).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));

import { JobType } from "../../src/api/types/firmware-jobs.js";
import { makeFirmwareJob } from "../_make-firmware-job.js";
import { mountDeviceCard as mount } from "./_device-card.js";

describe("device-card encryption indicator uses the raw pending flag", () => {
  it("shows encryption-pending but hides the modified dot when the gate is off", async () => {
    const el = await mount({
      hasPendingChanges: true, // raw: local edit not yet flashed
      showModified: false, // gated off: mDNS dark + hash-driven pending
      apiEnabled: true,
      apiEncrypted: true,
      apiEncryptionActive: null,
    });
    expect(el.shadowRoot!.querySelector(".encryption-icon.pending")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".indicator-dot--modified")).toBeNull();
  });
});

describe("device-card busy badge names the running job", () => {
  it("shows the compiling label for an active compile job", async () => {
    const el = await mount({
      busy: true,
      activeJob: makeFirmwareJob({ job_type: JobType.COMPILE }),
    });
    expect(el.shadowRoot!.querySelector(".device-status.busy")!.textContent).toContain(
      "dashboard.status_compiling"
    );
  });

  it("keeps the installing label for an active upload job", async () => {
    const el = await mount({
      busy: true,
      activeJob: makeFirmwareJob({ job_type: JobType.UPLOAD }),
    });
    expect(el.shadowRoot!.querySelector(".device-status.busy")!.textContent).toContain(
      "dashboard.status_installing"
    );
  });
});
