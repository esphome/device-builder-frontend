// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, test, vi } from "vitest";

// happy-dom can't host webawesome's form-associated internals; the submit
// flow's events and step transitions are what's under test.
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));

import { JobType } from "../../src/api/types/firmware-jobs.js";
import { ESPHomeRemoteBuildJobDialog } from "../../src/components/remote-build-job-dialog.js";
import { identityLocalize } from "../_dom.js";

async function mountForSubmit(target: JobType.COMPILE | JobType.UPLOAD) {
  const el = new ESPHomeRemoteBuildJobDialog();
  (el as any)._localize = identityLocalize;
  (el as any)._open = true;
  (el as any)._step = "input";
  (el as any)._pinSha256 = "ab".repeat(32);
  (el as any)._devices = [{ configuration: "kitchen.yaml", name: "Kitchen" }];
  (el as any)._configuration = "kitchen.yaml";
  (el as any)._target = target;
  (el as any)._api = {
    submitRemoteBuildJob: vi.fn().mockResolvedValue({ job_id: "job-1", accepted: true }),
  };
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

// The global DOM cleanup only clears body children, so listeners detach via
// this per-test abort instead of leaking across files in the same worker.
let listenerScope = new AbortController();
afterEach(() => {
  listenerScope.abort();
  listenerScope = new AbortController();
});

function captureEvents(names: string[]): Map<string, CustomEvent[]> {
  const seen = new Map<string, CustomEvent[]>(names.map((n) => [n, []]));
  for (const name of names) {
    document.body.addEventListener(
      name,
      (e) => {
        seen.get(name)!.push(e as CustomEvent);
      },
      { signal: listenerScope.signal }
    );
  }
  return seen;
}

describe("remote-build-job-dialog submit routing", () => {
  test("Compile only seeds the wire-job list and stays open on the list step", async () => {
    const el = await mountForSubmit(JobType.COMPILE);
    const seen = captureEvents([
      "remote-build-job-submitted",
      "remote-build-install-submitted",
    ]);

    await (el as any)._onSubmit();

    expect(seen.get("remote-build-job-submitted")).toHaveLength(1);
    expect(seen.get("remote-build-install-submitted")).toHaveLength(0);
    expect((el as any)._step).toBe("list");
    expect((el as any)._open).toBe(true);
    expect((el as any)._expandedJobId).toBe("job-1");
  });

  test("Compile and upload hands the firmware job off and closes", async () => {
    const el = await mountForSubmit(JobType.UPLOAD);
    const seen = captureEvents([
      "remote-build-job-submitted",
      "remote-build-install-submitted",
    ]);

    await (el as any)._onSubmit();

    const handoff = seen.get("remote-build-install-submitted")!;
    expect(handoff).toHaveLength(1);
    expect(handoff[0].detail).toEqual({ job_id: "job-1" });
    // No wire-list seed and no list step: the job is a FirmwareJob now,
    // tracked by the command dialog app-shell attaches on the hand-off.
    expect(seen.get("remote-build-job-submitted")).toHaveLength(0);
    expect((el as any)._open).toBe(false);
  });

  test("a rejected upload ack stays on the input step", async () => {
    const el = await mountForSubmit(JobType.UPLOAD);
    (el as any)._api.submitRemoteBuildJob = vi.fn().mockResolvedValue({
      job_id: "job-1",
      accepted: false,
      reason: "upload_unsupported",
    });
    const seen = captureEvents(["remote-build-install-submitted"]);

    await (el as any)._onSubmit();

    expect(seen.get("remote-build-install-submitted")).toHaveLength(0);
    expect((el as any)._step).toBe("input");
    expect((el as any)._submitErrorMessage).not.toBe("");
  });
});
