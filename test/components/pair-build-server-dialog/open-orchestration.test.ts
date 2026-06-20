/**
 * @vitest-environment happy-dom
 *
 * Pins open()'s auto-preview orchestration: with the guard satisfied it jumps
 * to the confirm step, marks the input step skipped, and dispatches the
 * fingerprint preview; otherwise (no api, no/blank hostname, or no autoPreview)
 * it stays on the input step.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));

import { ESPHomePairBuildServerDialog } from "../../../src/components/pair-build-server-dialog.js";

function makeApi() {
  return {
    getRemoteBuildIdentity: vi.fn(async () => ({
      dashboard_id: "x",
      pin_sha256: "p",
      server_version: "1",
      esphome_version: "1",
      listener_bound: true,
    })),
    previewRemoteBuildPair: vi.fn(async () => ({ pin_sha256: "abc" })),
  };
}

function makeDialog(api: unknown): ESPHomePairBuildServerDialog {
  const d = new ESPHomePairBuildServerDialog();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (d as any)._localize = (k: string) => k;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (d as any)._api = api;
  return d;
}

describe("pair dialog open() auto-preview orchestration", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("jumps to confirm, skips input, and previews when the guard passes", () => {
    const api = makeApi();
    const d = makeDialog(api);
    d.open({ hostname: "buildbox.local", port: 6055 }, { autoPreview: true });
    expect(d._step).toBe("confirm");
    expect(d._skippedInput).toBe(true);
    expect(api.previewRemoteBuildPair).toHaveBeenCalledOnce();
  });

  it("connecting state is busy but not sending, so the dialog stays dismissable", () => {
    const api = makeApi();
    const d = makeDialog(api);
    d.open({ hostname: "buildbox.local", port: 6055 }, { autoPreview: true });
    // The read-only preview marks _busy (spinner/submit-gate) but not _sending,
    // so base-dialog's busy gate doesn't veto Escape/outside-click/Cancel.
    expect(d._busy).toBe(true);
    expect(d._sending).toBe(false);
  });

  it("drops a stale preview result after the dialog is reopened", async () => {
    const api = makeApi();
    let resolvePreview: (v: { pin_sha256: string }) => void = () => {};
    api.previewRemoteBuildPair = vi.fn(() => new Promise((r) => (resolvePreview = r)));
    const d = makeDialog(api);
    // Pair host A: auto-preview starts and hangs (offline host).
    d.open({ hostname: "hostA.local", port: 6055 }, { autoPreview: true });
    // User dismisses and reopens the singleton for a fresh session.
    d.open();
    expect(d._step).toBe("input");
    // Host A's preview finally resolves, late.
    resolvePreview({ pin_sha256: "stale-a-pin" });
    await Promise.resolve();
    await Promise.resolve();
    // The stale result must not yank the fresh session to confirm.
    expect(d._step).toBe("input");
    expect(d._previewedPin).toBe("");
  });

  it("stays on input when the api is undefined", () => {
    const d = makeDialog(undefined);
    d.open({ hostname: "buildbox.local", port: 6055 }, { autoPreview: true });
    expect(d._step).toBe("input");
    expect(d._skippedInput).toBe(false);
  });

  it("stays on input for a blank/whitespace hostname", () => {
    const api = makeApi();
    const d = makeDialog(api);
    d.open({ hostname: "   ", port: 6055 }, { autoPreview: true });
    expect(d._step).toBe("input");
    expect(d._skippedInput).toBe(false);
    expect(api.previewRemoteBuildPair).not.toHaveBeenCalled();
  });

  it("stays on input without autoPreview even with a valid prefill", () => {
    const api = makeApi();
    const d = makeDialog(api);
    d.open({ hostname: "buildbox.local", port: 6055 });
    expect(d._step).toBe("input");
    expect(d._skippedInput).toBe(false);
    expect(api.previewRemoteBuildPair).not.toHaveBeenCalled();
  });
});
