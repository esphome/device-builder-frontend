// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  streamSerialLines: vi.fn(() => async () => {}),
  openLiveSerialPort: vi.fn(),
}));
vi.mock("../../src/util/serial-log-stream.js", () => ({
  streamSerialLines: mocks.streamSerialLines,
}));
vi.mock("../../src/util/serial-reacquire.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openLiveSerialPort: mocks.openLiveSerialPort,
}));

import { RTS_PULSE } from "../../src/web/logs/logs-policy.js";
import { SerialLogSource } from "../../src/web/logs/serial-source.js";

const hooks = { onLine: () => {}, onEnd: () => {} } as never;

function ports() {
  const dead = { close: vi.fn(async () => {}) } as unknown as SerialPort;
  const live = { setSignals: vi.fn(async () => {}) } as unknown as SerialPort;
  mocks.openLiveSerialPort.mockResolvedValue(live);
  return { dead, live };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("SerialLogSource reopen line policy", () => {
  // A UART bridge's auto-reset circuit must not be left holding the lines.
  it("drops DTR and RTS on the reopened handle before streaming by default", async () => {
    const { dead, live } = ports();
    const source = new SerialLogSource(dead, { reset: RTS_PULSE });
    await source.resume(hooks, () => false);
    const setSignals = vi.mocked(live.setSignals);
    expect(setSignals).toHaveBeenCalledWith({
      dataTerminalReady: false,
      requestToSend: false,
    });
    expect(setSignals.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.streamSerialLines.mock.invocationCallOrder[0]
    );
    expect(mocks.streamSerialLines).toHaveBeenCalledWith(live, hooks);
  });

  // arduino-pico's CDC only transmits while DTR is asserted.
  it("leaves the lines as reopened when the policy keeps them (a Pico)", async () => {
    const { dead, live } = ports();
    const source = new SerialLogSource(dead, {
      reset: RTS_PULSE,
      keepLinesOnReopen: true,
    });
    await source.resume(hooks, () => false);
    expect(live.setSignals).not.toHaveBeenCalled();
    expect(mocks.streamSerialLines).toHaveBeenCalledWith(live, hooks);
  });
});
