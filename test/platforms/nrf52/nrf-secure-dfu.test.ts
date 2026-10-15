import { describe, expect, it, vi } from "vitest";
import { disconnectEvents } from "../../_web-serial.js";
import { DfuResponseError } from "../../../src/platforms/nrf52/dfu-response-error.js";
import { SerialDeviceLostError } from "../../../src/util/serial-open-error.js";
import { FakeOpenDfuBootloader, fakeOpenDfuPort } from "./_fake-open-dfu-bootloader.js";

import {
  calcCrcRequest,
  createRequest,
  executeRequest,
  flashSecureDfuPackage,
  frameRequest,
  getMtuRequest,
  OBJECT_COMMAND,
  OBJECT_DATA,
  OP_CALC_CRC,
  OP_CREATE,
  OP_EXECUTE,
  OP_GET_MTU,
  OP_PING,
  OP_RESPONSE,
  OP_SELECT,
  OP_SET_PRN,
  OP_WRITE,
  parseResponse,
  pingRequest,
  responseFailure,
  RESULT_SUCCESS,
  selectRequest,
  setPrnRequest,
  writeChunkSize,
  writeRequest,
} from "../../../src/platforms/nrf52/nrf-secure-dfu.js";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("requests", () => {
  it("are one SLIP frame each, ended by a single END", () => {
    expect([...frameRequest(bytes(0x09, 0x01))]).toEqual([0x09, 0x01, 0xc0]);
    // An END or ESC in the data is escaped, never a frame boundary.
    expect([...frameRequest(bytes(0x08, 0xc0, 0xdb))]).toEqual([
      0x08, 0xdb, 0xdc, 0xdb, 0xdd, 0xc0,
    ]);
  });

  it("carry the opcode and its little-endian arguments", () => {
    expect([...pingRequest(0x1ff)]).toEqual([OP_PING, 0xff]);
    expect([...setPrnRequest(0x1234)]).toEqual([OP_SET_PRN, 0x34, 0x12]);
    expect([...getMtuRequest()]).toEqual([OP_GET_MTU]);
    expect([...selectRequest(OBJECT_DATA)]).toEqual([OP_SELECT, 0x02]);
    expect([...createRequest(OBJECT_COMMAND, 0x01020304)]).toEqual([
      OP_CREATE,
      0x01,
      0x04,
      0x03,
      0x02,
      0x01,
    ]);
    expect([...writeRequest(bytes(9, 8))]).toEqual([OP_WRITE, 9, 8]);
    expect([...calcCrcRequest()]).toEqual([OP_CALC_CRC]);
    expect([...executeRequest()]).toEqual([OP_EXECUTE]);
  });

  it("send as much data per write frame as the MTU allows once SLIP doubles it", () => {
    expect(writeChunkSize(64)).toBe(30); // pc-nrfutil's (mtu - 1) // 2 - 1
    expect(writeChunkSize(2048)).toBe(1022);
    expect(() => writeChunkSize(4)).toThrow(/MTU/);
  });
});

describe("responses", () => {
  it("are 0x60, the opcode, the result and the payload", () => {
    expect(parseResponse(bytes(0x60, OP_GET_MTU, 0x01, 0x40, 0x00))).toEqual({
      op: OP_GET_MTU,
      result: 0x01,
      payload: bytes(0x40, 0x00),
    });
    expect(parseResponse(bytes(0x60, OP_PING))).toBeNull();
    expect(parseResponse(bytes(0x01, 0x02, 0x03))).toBeNull();
  });

  it("name the result code, and the extended error's own reason", () => {
    expect(responseFailure({ op: OP_CREATE, result: 0x08, payload: bytes() })).toBe(
      "the bootloader answered operation not permitted"
    );
    expect(responseFailure({ op: OP_EXECUTE, result: 0x0b, payload: bytes(0x06) })).toBe(
      "the bootloader refused it: the hardware version does not match the one the firmware is built for"
    );
    expect(responseFailure({ op: OP_EXECUTE, result: 0x0b, payload: bytes(0x7f) })).toBe(
      "the bootloader refused it: unknown extended error 127"
    );
    expect(responseFailure({ op: OP_EXECUTE, result: 0x55, payload: bytes() })).toBe(
      "the bootloader answered result 0x55"
    );
  });
});

const dat = new Uint8Array(70).map((_, i) => i);
const app = new Uint8Array(6000).map((_, i) => (i * 7) & 0xff);
const pkg = { parts: [{ type: "application" as const, mode: 4, bin: app, dat }] };

describe("flashSecureDfuPackage", () => {
  it("sends the init packet as the command object and the image as data objects", async () => {
    const { port, bootloader } = fakeOpenDfuPort();
    const log: string[] = [];
    const progress: number[] = [];
    await flashSecureDfuPackage(port, pkg, {
      onProgress: (p) => progress.push(p),
      onLog: (l) => log.push(l),
    });
    expect([...bootloader.initPacket]).toEqual([...dat]);
    expect([...bootloader.image]).toEqual([...app]);
    expect(bootloader.prn).toBe(0);
    expect(progress[progress.length - 1]).toBe(100);
    expect(port.close).toHaveBeenCalledOnce();
    // The fake port is built open (its streams exist), so there is no open line.
    expect(log).toEqual([
      "Pinging the bootloader",
      "Serial MTU: 64 bytes",
      "Application image: 6000 bytes",
      "Sending the init packet (70 bytes)",
      "Transferring 6000 bytes in 2 objects of up to 4096 bytes",
      "Transferring: 50%",
      "Transferring: 100%",
      "Transfer complete; the bootloader starts the firmware",
    ]);
    const ops = bootloader.requests.filter((op) => op !== OP_WRITE);
    expect(ops).toEqual([
      OP_PING,
      OP_SET_PRN,
      OP_GET_MTU,
      OP_SELECT,
      OP_CREATE,
      OP_CALC_CRC,
      OP_EXECUTE,
      OP_SELECT,
      OP_CREATE,
      OP_CALC_CRC,
      OP_EXECUTE,
      OP_CREATE,
      OP_CALC_CRC,
      OP_EXECUTE,
    ]);
    // 70 bytes of init packet in 30-byte frames, then 6000 of image.
    const writes = bootloader.requests.filter((op) => op === OP_WRITE).length;
    expect(writes).toBe(3 + Math.ceil(4096 / 30) + Math.ceil(1904 / 30));
  });

  it("reads past frames left in the bootloader without pinging again", async () => {
    const bootloader = new FakeOpenDfuBootloader();
    // An earlier session's CRC answer, an earlier ping's, and a refused ping
    // ahead of ours; a second answer to ours trailing it.
    bootloader.staleFrames = [
      [OP_RESPONSE, OP_CALC_CRC, RESULT_SUCCESS, 0, 0, 0, 0, 0, 0, 0, 0],
      [OP_RESPONSE, OP_PING, RESULT_SUCCESS, 0xee],
      [OP_RESPONSE, OP_PING, 0x08],
    ];
    bootloader.trailingFrames = [[OP_RESPONSE, OP_PING, RESULT_SUCCESS, 1]];
    const { port } = fakeOpenDfuPort(bootloader);
    await flashSecureDfuPackage(port, pkg, { onProgress: () => {} });
    expect(bootloader.requests.filter((op) => op === OP_PING)).toHaveLength(1);
    expect([...bootloader.image]).toEqual([...app]);
  });

  it("fails when the bootloader takes objects of no size", async () => {
    const bootloader = new FakeOpenDfuBootloader();
    bootloader.maxDataSize = 0;
    const { port } = fakeOpenDfuPort(bootloader);
    await expect(
      flashSecureDfuPackage(port, pkg, { onProgress: () => {} })
    ).rejects.toThrow("The bootloader takes objects of 0 bytes");
    expect(bootloader.requests.filter((op) => op === OP_CREATE)).toHaveLength(1);
    expect(port.close).toHaveBeenCalledOnce();
  });

  it("gives up after three unanswered pings", async () => {
    vi.useFakeTimers();
    try {
      const bootloader = new FakeOpenDfuBootloader();
      bootloader.onRequest = (op) => (op === OP_PING ? null : undefined);
      const { port } = fakeOpenDfuPort(bootloader);
      const flash = flashSecureDfuPackage(port, pkg, { onProgress: () => {} });
      const failed = expect(flash).rejects.toThrow(
        "The bootloader did not answer the ping (3 attempts)"
      );
      await vi.advanceTimersByTimeAsync(3000);
      await failed;
      expect(bootloader.requests).toEqual([OP_PING, OP_PING, OP_PING]);
      expect(port.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails the ping on a write that fails, without trying again", async () => {
    const { port, bootloader } = fakeOpenDfuPort();
    Object.assign(port, {
      writable: new WritableStream<Uint8Array>({
        write: () => Promise.reject(new Error("USB write failed")),
      }),
    });
    await expect(
      flashSecureDfuPackage(port, pkg, { onProgress: () => {} })
    ).rejects.toThrow("USB write failed");
    expect(bootloader.requests).toEqual([]);
    expect(port.close).toHaveBeenCalledOnce();
  });

  it("fails a request the bootloader answers with another opcode", async () => {
    const bootloader = new FakeOpenDfuBootloader();
    bootloader.onRequest = (op) =>
      op === OP_SET_PRN ? [OP_PING, RESULT_SUCCESS, 1] : undefined;
    const { port } = fakeOpenDfuPort(bootloader);
    const flash = flashSecureDfuPackage(port, pkg, { onProgress: () => {} });
    await expect(flash).rejects.toThrow(DfuResponseError);
    await expect(flash).rejects.toThrow(
      "Set receipt notification: the bootloader answered something else"
    );
    expect(port.close).toHaveBeenCalledOnce();
  });

  it("refuses a package that is not one application image before touching the port", async () => {
    const { port, bootloader } = fakeOpenDfuPort();
    const twoImages = { parts: [{ ...pkg.parts[0], type: "softdevice" }, pkg.parts[0]] };
    await expect(
      flashSecureDfuPackage(port, twoImages as typeof pkg, { onProgress: () => {} })
    ).rejects.toThrow(
      "Not a package for this bootloader: the package holds softdevice + application; Secure DFU over USB takes one application image"
    );
    expect(bootloader.requests).toEqual([]);
    expect(port.close).not.toHaveBeenCalled();
  });

  it("names the request the bootloader refused, with its reason", async () => {
    const bootloader = new FakeOpenDfuBootloader();
    bootloader.onRequest = (op) => (op === OP_EXECUTE ? [op, 0x0b, 0x05] : undefined);
    const { port } = fakeOpenDfuPort(bootloader);
    const flash = flashSecureDfuPackage(port, pkg, { onProgress: () => {} });
    await expect(flash).rejects.toThrow(DfuResponseError);
    await expect(flash).rejects.toThrow(
      "Execute object: the bootloader refused it: the firmware version is lower than the one on the device (no downgrade)"
    );
    expect(port.close).toHaveBeenCalledOnce();
  });

  it("names a Write the bootloader refused instead of the CRC mismatch it leaves", async () => {
    const bootloader = new FakeOpenDfuBootloader();
    let writes = 0;
    bootloader.onRequest = (op) =>
      op === OP_WRITE && ++writes === 5 ? [op, 0x04] : undefined;
    const { port } = fakeOpenDfuPort(bootloader);
    const flash = flashSecureDfuPackage(port, pkg, { onProgress: () => {} });
    await expect(flash).rejects.toThrow(DfuResponseError);
    await expect(flash).rejects.toThrow(
      "Write object: the bootloader answered insufficient resources"
    );
    expect(port.close).toHaveBeenCalledOnce();
  });

  it("names a Write refusal that arrives in place of the CRC answer", async () => {
    const bootloader = new FakeOpenDfuBootloader();
    bootloader.onRequest = (op) => (op === OP_CALC_CRC ? [OP_WRITE, 0x05] : undefined);
    const { port } = fakeOpenDfuPort(bootloader);
    await expect(
      flashSecureDfuPackage(port, pkg, { onProgress: () => {} })
    ).rejects.toThrow("Write object: the bootloader answered invalid object");
    expect(port.close).toHaveBeenCalledOnce();
  });

  it("fails when the bootloader's CRC does not match what was sent", async () => {
    const bootloader = new FakeOpenDfuBootloader();
    let checks = 0;
    bootloader.onRequest = (op) =>
      op === OP_CALC_CRC && ++checks === 2
        ? [op, 0x01, 0, 0, 0, 0, 1, 2, 3, 4]
        : undefined;
    const { port } = fakeOpenDfuPort(bootloader);
    await expect(
      flashSecureDfuPackage(port, pkg, { onProgress: () => {} })
    ).rejects.toThrow(/holds 0 bytes with CRC 0x4030201, expected 4096 bytes/);
    expect(port.close).toHaveBeenCalledOnce();
  });

  it("stops on abort and releases the port", async () => {
    const { port } = fakeOpenDfuPort();
    const abort = new AbortController();
    abort.abort();
    await expect(
      flashSecureDfuPackage(port, pkg, { onProgress: () => {}, signal: abort.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(port.close).toHaveBeenCalledOnce();
  });

  it("fails fast when the port drops mid-flash", async () => {
    const port = {
      open: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      // The device vanishes: reads end immediately, writes still succeed.
      ...disconnectEvents(),
      readable: new ReadableStream<Uint8Array>({ start: (c) => c.close() }),
      writable: new WritableStream<Uint8Array>(),
    } as unknown as SerialPort;
    await expect(
      flashSecureDfuPackage(port, pkg, { onProgress: () => {} })
    ).rejects.toThrow(SerialDeviceLostError);
    expect(port.close).toHaveBeenCalled();
  });

  it("opens a closed port at 115200 first", async () => {
    const { port } = fakeOpenDfuPort();
    const streams = { readable: port.readable, writable: port.writable };
    Object.assign(port, { readable: null, writable: null });
    const open = vi.fn(async () => Object.assign(port, streams));
    Object.assign(port, { open });
    const log: string[] = [];
    await flashSecureDfuPackage(port, pkg, {
      onProgress: () => {},
      onLog: (l) => log.push(l),
    });
    expect(open).toHaveBeenCalledWith({ baudRate: 115200 });
    expect(log[0]).toBe("Opening the DFU port at 115200 baud");
  });
});
