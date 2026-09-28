import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requestSerialPort: vi.fn() }));
vi.mock("../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestSerialPort: mocks.requestSerialPort,
}));

import { withWebSerial } from "../_web-serial.js";
import { serialRun } from "../../src/web/flash-receiver/serial-run.js";
import { recordingHooks as hooks } from "./_receiver-hooks.js";

const port = {} as SerialPort;
let restore = () => {};

beforeEach(() => {
  restore = withWebSerial(true, { getPorts: async () => [port] });
  mocks.requestSerialPort.mockResolvedValue(port);
});
afterEach(() => {
  restore();
  vi.resetAllMocks();
});

describe("serialRun and where the logs are", () => {
  it("offers the logs on the port the flash went over", async () => {
    const run = serialRun(
      (k) => k,
      async () => ({ rebooted: true })
    );

    expect(await run(hooks())).toEqual({
      note: undefined,
      logs: { port, knownPorts: [port], rebooted: true },
    });
  });

  it("offers none for a board that logs on another port, and keeps what it says", async () => {
    const note = { message: "move the wire" };
    const run = serialRun(
      (k) => k,
      async () => ({ logsElsewhere: true, note })
    );

    expect(await run(hooks())).toEqual({ note });
  });
});
