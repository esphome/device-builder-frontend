import type { ReactiveController, ReactiveControllerHost } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type { SerialPort } from "../../src/api/types/system.js";
import {
  SERIAL_PORTS_POLL_INTERVAL_MS,
  SerialPortsPollController,
} from "../../src/util/serial-ports-poll-controller.js";

class FakeHost implements ReactiveControllerHost {
  controllers: ReactiveController[] = [];
  updates = 0;
  addController(c: ReactiveController) {
    this.controllers.push(c);
  }
  removeController() {}
  requestUpdate() {
    this.updates++;
  }
  updateComplete = Promise.resolve(true);
}

const A: SerialPort = { port: "/dev/ttyUSB0", desc: "CP2102" };
const B: SerialPort = { port: "/dev/ttyUSB1", desc: "CH340" };

function make(initial: SerialPort[] = [A]) {
  const host = new FakeHost();
  let result: SerialPort[] | Error = initial;
  const getSerialPorts = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const onInitialError = vi.fn();
  const ctrl = new SerialPortsPollController(
    host,
    () => ({ getSerialPorts }) as unknown as ESPHomeAPI,
    { onInitialError }
  );
  return {
    host,
    ctrl,
    getSerialPorts,
    onInitialError,
    respond(next: SerialPort[] | Error) {
      result = next;
    },
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const tick = () => vi.advanceTimersByTimeAsync(SERIAL_PORTS_POLL_INTERVAL_MS);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SerialPortsPollController", () => {
  it("fetches immediately on activation and re-fetches on the interval", async () => {
    const { ctrl, getSerialPorts, respond } = make([A]);
    expect(ctrl.loading).toBe(false);

    ctrl.set(true);
    expect(ctrl.loading).toBe(true);
    await flush();
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
    await flush();

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
    await flush();
    ctrl.set(false);
    await tick();
    await tick();
    expect(getSerialPorts).toHaveBeenCalledTimes(1);

    ctrl.set(true);
    await flush();
    expect(getSerialPorts).toHaveBeenCalledTimes(2);
    ctrl.hostDisconnected();
    await tick();
    expect(getSerialPorts).toHaveBeenCalledTimes(2);
  });

  it("resets the list and the new-port baseline on each activation", async () => {
    const { ctrl, respond } = make([A]);
    ctrl.set(true);
    await flush();
    respond([A, B]);
    await tick();
    expect(ctrl.newPorts.has(B.port)).toBe(true);

    ctrl.set(false);
    expect(ctrl.ports).toEqual([A, B]);

    ctrl.set(true);
    expect(ctrl.ports).toEqual([]);
    await flush();
    expect(ctrl.ports).toEqual([A, B]);
    expect(ctrl.newPorts.size).toBe(0);
  });

  it("only requests a host update when the list actually changes", async () => {
    const { ctrl, host } = make([A]);
    ctrl.set(true);
    await flush();
    const after = host.updates;
    await tick();
    await tick();
    expect(host.updates).toBe(after);
  });

  it("reports an initial-fetch error once and seeds the baseline from the next success", async () => {
    const { ctrl, host, respond, onInitialError } = make();
    const boom = new Error("boom");
    respond(boom);
    ctrl.set(true);
    await flush();
    expect(onInitialError).toHaveBeenCalledWith(boom);
    expect(ctrl.loading).toBe(false);
    expect(host.updates).toBe(1);

    respond([A, B]);
    await tick();
    expect(ctrl.ports).toEqual([A, B]);
    expect(ctrl.newPorts.size).toBe(0);
  });

  it("swallows poll errors after a successful fetch, keeping the last good list", async () => {
    const { ctrl, respond, onInitialError } = make([A]);
    ctrl.set(true);
    await flush();

    respond(new Error("transient"));
    await tick();
    expect(ctrl.ports).toEqual([A]);
    expect(onInitialError).not.toHaveBeenCalled();

    respond([A, B]);
    await tick();
    expect(ctrl.ports).toEqual([A, B]);
    expect(ctrl.newPorts.has(B.port)).toBe(true);
  });
});
