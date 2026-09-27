// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { pickerRefused, withWebSerial } from "../_web-serial.js";
import { serialRun } from "../../src/web/flash-receiver/serial-run.js";
import { recordingHooks as hooks } from "./_receiver-hooks.js";

const port = { getInfo: () => ({}) } as unknown as SerialPort;
const other = { getInfo: () => ({}) } as unknown as SerialPort;

let restore = (): void => {};
const serial = (value: object) => {
  restore = withWebSerial(true, value);
};

afterEach(() => {
  restore();
  restore = () => {};
});

describe("serialRun", () => {
  it("asks for the port first, with nothing awaited before it", async () => {
    const requestPort = vi.fn(async () => port);
    serial({ requestPort, getPorts: async () => [] });
    const run = serialRun(
      (k) => k,
      async () => ({ rebooted: true })
    );

    // Not awaited: the picker has to be asked for before the click's turn ends.
    const done = run(hooks());
    expect(requestPort).toHaveBeenCalledOnce();
    await done;
  });

  it("runs over the picked port and hands it on with the ports known before", async () => {
    serial({ requestPort: async () => port, getPorts: async () => [port, other] });
    const flash = vi.fn(async () => ({ rebooted: false, note: { message: "reset it" } }));
    const h = hooks();

    const result = await serialRun((k) => k, flash)(h);

    expect(flash).toHaveBeenCalledWith(port, h);
    expect(result).toEqual({
      note: { message: "reset it" },
      logs: { port, knownPorts: [port, other], rebooted: false },
    });
  });

  it("runs without the known ports when they cannot be listed", async () => {
    serial({
      requestPort: async () => port,
      getPorts: async () => {
        throw new Error("blocked");
      },
    });

    const result = await serialRun(
      (k) => k,
      async () => ({ rebooted: true })
    )(hooks());

    expect(result).toEqual({
      note: undefined,
      logs: { port, knownPorts: [], rebooted: true },
    });
  });

  it("is dismissed when the picker is closed, and runs nothing", async () => {
    serial({
      requestPort: async () => {
        throw new DOMException("No port selected", "NotFoundError");
      },
    });
    const flash = vi.fn();
    const h = hooks();

    expect(await serialRun((k) => k, flash)(h)).toBe("dismissed");
    expect(flash).not.toHaveBeenCalled();
    expect(h.states).toEqual([]);
  });

  it("names a picker that failed, and runs nothing", async () => {
    serial({ requestPort: async () => Promise.reject(pickerRefused()) });
    const flash = vi.fn();
    const h = hooks();

    expect(await serialRun((k) => k, flash)(h)).toBeNull();
    expect(flash).not.toHaveBeenCalled();
    expect(h.states).toHaveLength(1);
    expect(h.states[0]).toMatch(/^error:/);
  });

  it("passes a failed run on without a port", async () => {
    serial({ requestPort: async () => port, getPorts: async () => [] });

    expect(
      await serialRun(
        (k) => k,
        async () => null
      )(hooks())
    ).toBeNull();
  });
});
