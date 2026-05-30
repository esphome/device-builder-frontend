/**
 * @vitest-environment happy-dom
 *
 * The states-toggle restart awaits stopStream before respawning; a close
 * during that await must not spawn a stream onto the closed dialog.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ESPHomeLogsDialog } from "../../src/components/logs-dialog.js";

interface DeferredStop {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): DeferredStop {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("logs-dialog states-toggle restart", () => {
  let el: ESPHomeLogsDialog;
  let logs: ReturnType<typeof vi.fn>;
  let stop: DeferredStop;
  let stopStream: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    el = new ESPHomeLogsDialog();
    stop = deferred();
    let n = 0;
    logs = vi.fn(() => `stream-${++n}`);
    stopStream = vi.fn(() => stop.promise);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._api = { logs, stopStream };
  });

  it("does not respawn a stream when the dialog is closed mid-restart", async () => {
    el.open("OTA");
    expect(logs).toHaveBeenCalledTimes(1); // initial subscription
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._open).toBe(true);

    // Flip the states toggle: awaits the stopStream cancel before respawning.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const restart = (el as any)._toggleShowStates();

    // The user closes the dialog while the cancel round-trip is outstanding.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._onDialogHide();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._open).toBe(false);

    stop.resolve(); // the cancel lands; the toggle continuation runs
    await restart;

    // No fresh subscription on the closed dialog, and no orphan stream id.
    expect(logs).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._streamId).toBe("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._streaming).toBe(false);
  });

  it("still respawns the stream when the dialog stays open", async () => {
    el.open("OTA");
    expect(logs).toHaveBeenCalledTimes(1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const restart = (el as any)._toggleShowStates();
    stop.resolve(); // cancel lands while the dialog is still open
    await restart;

    // The toggle respawns with the new --no-states flag.
    expect(logs).toHaveBeenCalledTimes(2);
    expect(stopStream).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._streamId).toBe("stream-2");
  });
});
