// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";

// happy-dom can't host webawesome's form-associated internals; the dialog's
// own button markup is what's under test.
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));

import { ESPHomeRemoteBuildJobDialog } from "../../src/components/remote-build-job-dialog.js";
import { stubRemoteBuildJobState } from "../../src/context/index.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function mountInputStep() {
  const el = new ESPHomeRemoteBuildJobDialog();
  (el as any)._localize = (k: string) => k;
  (el as any)._open = true;
  (el as any)._step = "input";
  (el as any)._pinSha256 = "ab".repeat(32);
  (el as any)._devices = [{ configuration: "kitchen.yaml", name: "Kitchen" }];
  (el as any)._configuration = "kitchen.yaml";
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

/** List step with one non-terminal (QUEUED) job, its row expanded so the
 *  per-row Cancel (.btn--danger) button renders. */
async function mountExpandedListStep() {
  const el = new ESPHomeRemoteBuildJobDialog();
  const job = stubRemoteBuildJobState("job-1", "ab".repeat(32));
  (el as any)._localize = (k: string) => k;
  (el as any)._open = true;
  (el as any)._step = "list";
  (el as any)._jobs = new Map([[job.job_id, job]]);
  (el as any)._expandedJobId = job.job_id;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** A button carries every class in *want* and none of the old unstyled ones. */
function hasClasses(el: Element, want: string[]): boolean {
  return (
    want.every((c) => el.classList.contains(c)) &&
    !["btn-secondary", "btn-primary", "btn-danger"].some((c) => el.classList.contains(c))
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("remote-build-job-dialog action buttons", () => {
  test("input-step buttons use the shared cancel / primary classes", async () => {
    const el = await mountInputStep();
    const buttons = [...el.shadowRoot!.querySelectorAll(".actions button")];
    expect(buttons.some((b) => hasClasses(b, ["btn", "btn--cancel"]))).toBe(true);
    expect(buttons.some((b) => hasClasses(b, ["btn", "btn--primary"]))).toBe(true);
  });

  test("the per-row Cancel button carries btn + btn--danger so it keeps the shared base", async () => {
    // The danger rule dropped its hand-rolled base shape; without the .btn base
    // the button would lose all sizing, so both classes must be present.
    const el = await mountExpandedListStep();
    const cancel = el.shadowRoot!.querySelector(".row-actions button");
    expect(cancel).not.toBeNull();
    expect(hasClasses(cancel!, ["btn", "btn--danger"])).toBe(true);
  });
});
