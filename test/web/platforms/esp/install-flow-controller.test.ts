import type { ReactiveControllerHost } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/web/platforms/esp/run-flash.js", () => ({ runFlash: vi.fn() }));

import { InstallFlowController } from "../../../../src/web/platforms/esp/install-flow-controller.js";
import { runFlash } from "../../../../src/web/platforms/esp/run-flash.js";

function fakeHost(): ReactiveControllerHost {
  return {
    addController: vi.fn(),
    removeController: vi.fn(),
    requestUpdate: vi.fn(),
    updateComplete: Promise.resolve(true),
  };
}

afterEach(() => vi.clearAllMocks());

describe("InstallFlowController", () => {
  it("registers itself with the host and starts idle", () => {
    const host = fakeHost();
    const flow = new InstallFlowController(host);
    expect(host.addController).toHaveBeenCalledWith(flow);
    expect(flow.step).toBe("idle");
    expect(flow.busy).toBe(false);
    expect(flow.done).toBe(false);
    expect(flow.errored).toBe(false);
  });

  it("maps runFlash hooks onto reactive state and requests updates", async () => {
    const host = fakeHost();
    const flow = new InstallFlowController(host);
    const port = {} as SerialPort;

    vi.mocked(runFlash).mockImplementation(async (_port, _plan, hooks) => {
      hooks.onStep("connecting");
      expect(flow.busy).toBe(true);
      hooks.onLog("chip detected");
      hooks.onStep("flashing");
      hooks.onProgress(42);
      hooks.onStep("done");
      return true;
    });

    const ok = await flow.start(port, { filesCallback: async () => [] });

    expect(ok).toBe(true);
    expect(flow.step).toBe("done");
    expect(flow.done).toBe(true);
    expect(flow.progress).toBe(42);
    expect(flow.logLines).toEqual(["chip detected"]);
    expect(host.requestUpdate).toHaveBeenCalled();
  });

  it("captures the error message and flags errored", async () => {
    const host = fakeHost();
    const flow = new InstallFlowController(host);
    vi.mocked(runFlash).mockImplementation(async (_p, _plan, hooks) => {
      hooks.onStep("error");
      hooks.onError("boom");
      return false;
    });

    const ok = await flow.start({} as SerialPort, { filesCallback: async () => [] });

    expect(ok).toBe(false);
    expect(flow.errored).toBe(true);
    expect(flow.errorMessage).toBe("boom");
  });

  it("reset() clears state back to idle", async () => {
    const host = fakeHost();
    const flow = new InstallFlowController(host);
    vi.mocked(runFlash).mockImplementation(async (_p, _plan, hooks) => {
      hooks.onStep("error");
      hooks.onError("boom");
      hooks.onProgress(10);
      return false;
    });
    await flow.start({} as SerialPort, { filesCallback: async () => [] });

    flow.reset();

    expect(flow.step).toBe("idle");
    expect(flow.progress).toBeNull();
    expect(flow.errorMessage).toBe("");
    expect(flow.logLines).toEqual([]);
  });

  it("start() resets prior state before running", async () => {
    const host = fakeHost();
    const flow = new InstallFlowController(host);
    flow.errorMessage = "stale";
    flow.logLines = ["old"];
    vi.mocked(runFlash).mockResolvedValue(true);

    await flow.start({} as SerialPort, { filesCallback: async () => [] });

    expect(flow.errorMessage).toBe("");
    expect(flow.logLines).toEqual([]);
  });
});
