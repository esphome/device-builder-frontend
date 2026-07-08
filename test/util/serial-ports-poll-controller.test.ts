import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type { SerialPort } from "../../src/api/types/system.js";
import {
  SERIAL_PORTS_POLL_INTERVAL_MS,
  SerialPortsPollController,
  sortSerialPorts,
} from "../../src/util/serial-ports-poll-controller.js";
import { flushTimers } from "../_dom.js";
import { FakeHost } from "../_fake-host.js";
import { makeSerialPort } from "../_make-serial-port.js";

const A: SerialPort = makeSerialPort("/dev/ttyUSB0", "CP2102");
const B: SerialPort = makeSerialPort("/dev/ttyUSB1", "CH340");

function make(initial: SerialPort[] = [A]) {
  const host = new FakeHost();
  let result: SerialPort[] | Error = initial;
  const getSerialPorts = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const ctrl = new SerialPortsPollController(
    host,
    () => ({ getSerialPorts }) as unknown as ESPHomeAPI
  );
  return {
    host,
    ctrl,
    getSerialPorts,
    respond(next: SerialPort[] | Error) {
      result = next;
    },
  };
}

const tick = () => vi.advanceTimersByTimeAsync(SERIAL_PORTS_POLL_INTERVAL_MS);

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SerialPortsPollController", () => {
  it("fetches immediately on activation and re-fetches on the interval", async () => {
    const { ctrl, getSerialPorts, respond } = make([A]);
    expect(ctrl.loading).toBe(false);

    ctrl.set(true);
    expect(ctrl.loading).toBe(true);
    await flushTimers();
    expect(getSerialPorts).toHaveBeenCalledTimes(1);
    expect(ctrl.loading).toBe(false);
    expect(ctrl.ports).toEqual([A]);
    expect(ctrl.newPorts.size).toBe(0);

    respond([A, B]);
    await tick();
    expect(getSerialPorts).toHaveBeenCalledTimes(2);
    expect(ctrl.ports).toEqual([A, B]);
  });

  it("flags ports that appear after the first fetch and keeps them flagged while present", async () => {
    const { ctrl, respond } = make([A]);
    ctrl.set(true);
    await flushTimers();

    respond([A, B]);
    await tick();
    expect(ctrl.newPorts.has(B.port)).toBe(true);
    expect(ctrl.newPorts.has(A.port)).toBe(false);

    await tick();
    expect(ctrl.newPorts.has(B.port)).toBe(true);

    respond([A]);
    await tick();
    expect(ctrl.newPorts.size).toBe(0);

    respond([A, B]);
    await tick();
    expect(ctrl.newPorts.has(B.port)).toBe(true);
  });

  it("stops polling on deactivation and on host disconnect", async () => {
    const { ctrl, getSerialPorts } = make();
    ctrl.set(true);
    await flushTimers();
    ctrl.set(false);
    await tick();
    await tick();
    expect(getSerialPorts).toHaveBeenCalledTimes(1);

    ctrl.set(true);
    await flushTimers();
    expect(getSerialPorts).toHaveBeenCalledTimes(2);
    ctrl.hostDisconnected();
    await tick();
    expect(getSerialPorts).toHaveBeenCalledTimes(2);
  });

  it("does not fetch from an interval callback that was queued before deactivation", async () => {
    const { ctrl, getSerialPorts } = make();
    ctrl.set(true);
    await flushTimers();
    ctrl.set(false);
    // A callback already queued when clearInterval ran still fires.
    await (ctrl as unknown as { _poll(): Promise<void> })._poll();
    expect(getSerialPorts).toHaveBeenCalledTimes(1);
  });

  it("resets the list and the new-port baseline on each activation", async () => {
    const { ctrl, respond } = make([A]);
    ctrl.set(true);
    await flushTimers();
    respond([A, B]);
    await tick();
    expect(ctrl.newPorts.has(B.port)).toBe(true);

    ctrl.set(false);
    expect(ctrl.ports).toEqual([A, B]);

    ctrl.set(true);
    expect(ctrl.ports).toEqual([]);
    await flushTimers();
    expect(ctrl.ports).toEqual([A, B]);
    expect(ctrl.newPorts.size).toBe(0);
  });

  it("only requests a host update when the list actually changes", async () => {
    const { ctrl, host } = make([A]);
    ctrl.set(true);
    await flushTimers();
    const after = host.updates;
    await tick();
    await tick();
    expect(host.updates).toBe(after);
  });

  it("exposes an initial-fetch error and clears it on the next successful poll", async () => {
    const { ctrl, host, respond } = make();
    const boom = new Error("boom");
    respond(boom);
    ctrl.set(true);
    await flushTimers();
    expect(ctrl.error).toBe(boom);
    expect(ctrl.loading).toBe(false);
    expect(host.updates).toBe(1);

    // Recovery must surface even when the recovered list is empty.
    respond([]);
    await tick();
    expect(ctrl.error).toBeNull();
    expect(ctrl.ports).toEqual([]);
    expect(host.updates).toBe(2);

    // The empty success seeded the baseline, so later ports are new.
    respond([A, B]);
    await tick();
    expect(ctrl.ports).toEqual([A, B]);
    expect(ctrl.newPorts.size).toBe(2);
  });

  it("seeds the new-port baseline from the first success after an initial error", async () => {
    const { ctrl, respond } = make();
    respond(new Error("boom"));
    ctrl.set(true);
    await flushTimers();

    respond([A, B]);
    await tick();
    expect(ctrl.error).toBeNull();
    expect(ctrl.ports).toEqual([A, B]);
    expect(ctrl.newPorts.size).toBe(0);
  });

  it("sorts likely ESP candidates first", async () => {
    const generic = makeSerialPort("/dev/cu.usbmodem1", "Some webcam");
    const bridge = makeSerialPort("/dev/cu.usbserial-2", "CH340", {
      vid: 0x1a86,
      hint: "bridge",
    });
    const esp = makeSerialPort("/dev/cu.usbmodem3", "USB JTAG/serial debug unit", {
      vid: 0x303a,
      hint: "esp",
    });
    expect(sortSerialPorts([generic, bridge, esp])).toEqual([esp, bridge, generic]);

    const com2 = makeSerialPort("COM2", "CP2102");
    const com10 = makeSerialPort("COM10", "CP2102");
    expect(sortSerialPorts([com10, com2])).toEqual([com2, com10]);

    const { ctrl } = make([generic, bridge, esp]);
    ctrl.set(true);
    await flushTimers();
    expect(ctrl.ports).toEqual([esp, bridge, generic]);
  });

  it("swallows poll errors after a successful fetch, keeping the last good list", async () => {
    const { ctrl, respond } = make([A]);
    ctrl.set(true);
    await flushTimers();

    respond(new Error("transient"));
    await tick();
    expect(ctrl.ports).toEqual([A]);
    expect(ctrl.error).toBeNull();

    respond([A, B]);
    await tick();
    expect(ctrl.ports).toEqual([A, B]);
    expect(ctrl.newPorts.has(B.port)).toBe(true);
  });
});
