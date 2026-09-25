import { describe, expect, it, vi } from "vitest";

import {
  buildCommandPacket,
  FLASH_SECTOR_SIZE,
  flashUf2,
  PICOBOOT_MAGIC,
  PicobootCmd,
  PicobootDevice,
  PicobootError,
} from "../../src/util/rp2-picoboot.js";
import { isRecentSerialActivity } from "../../src/util/serial-reacquire.js";
import type { Uf2Image } from "../../src/util/uf2.js";
import { classifyUsbDevice } from "../../src/util/web-usb.js";

const BASE = 0x10000000;

type Transfer =
  | { kind: "out"; ep: number; data: Uint8Array }
  | { kind: "in"; ep: number; length: number }
  | { kind: "control-out"; request: number; index: number }
  | { kind: "control-in"; request: number; index: number }
  | { kind: "clear-halt"; direction: string; ep: number }
  | { kind: "claim"; iface: number }
  | { kind: "release"; iface: number }
  | { kind: "close" };

/** Records every call; ``inQueue`` scripts the bulk IN results (default: a zero-length ACK). */
class FakeUsbDevice {
  vendorId = 0x2e8a;
  productId = 0x0003;
  opened = false;
  configuration: unknown = {
    interfaces: [
      {
        interfaceNumber: 0,
        alternates: [
          {
            interfaceClass: 0x08,
            interfaceSubclass: 6,
            interfaceProtocol: 80,
            endpoints: [],
          },
        ],
      },
      {
        interfaceNumber: 1,
        alternates: [
          {
            interfaceClass: 0xff,
            interfaceSubclass: 0,
            interfaceProtocol: 0,
            endpoints: [
              { endpointNumber: 3, direction: "out", type: "bulk" },
              { endpointNumber: 4, direction: "in", type: "bulk" },
            ],
          },
        ],
      },
    ],
  };
  log: Transfer[] = [];
  inQueue: USBInTransferResult[] = [];
  outStatus: USBTransferStatus = "ok";
  /** When set, bulk IN reads hang until close() rejects them, as WebUSB does. */
  hangIn = false;
  shortWrite = false;
  private pendingIn: ((err: Error) => void)[] = [];
  statusResponse = new Uint8Array(16);
  failOn: ((t: Transfer) => Error | null) | null = null;

  // WebUSB rejects every transfer once the device is closed.
  private maybeFail(t: Transfer): void {
    if (!this.opened) {
      throw new DOMException("The device must be opened first.", "InvalidStateError");
    }
    const err = this.failOn?.(t);
    if (err) throw err;
  }

  async open() {
    this.opened = true;
  }
  async close() {
    this.log.push({ kind: "close" });
    this.opened = false;
    for (const reject of this.pendingIn.splice(0)) {
      reject(new DOMException("The device was closed.", "InvalidStateError"));
    }
  }
  async selectConfiguration() {}
  async claimInterface(iface: number) {
    this.log.push({ kind: "claim", iface });
  }
  async releaseInterface(iface: number) {
    this.log.push({ kind: "release", iface });
  }
  async clearHalt(direction: string, ep: number) {
    this.log.push({ kind: "clear-halt", direction, ep });
  }
  async controlTransferOut(setup: USBControlTransferParameters) {
    this.log.push({ kind: "control-out", request: setup.request, index: setup.index });
    return { status: "ok" as const, bytesWritten: 0 };
  }
  async controlTransferIn(setup: USBControlTransferParameters) {
    const t: Transfer = {
      kind: "control-in",
      request: setup.request,
      index: setup.index,
    };
    this.log.push(t);
    this.maybeFail(t);
    return { status: "ok" as const, data: new DataView(this.statusResponse.buffer) };
  }
  async transferOut(ep: number, data: BufferSource) {
    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const t: Transfer = { kind: "out", ep, data: bytes };
    this.log.push(t);
    this.maybeFail(t);
    return {
      status: this.outStatus,
      bytesWritten: this.shortWrite ? bytes.length - 1 : bytes.length,
    };
  }
  async transferIn(ep: number, length: number) {
    const t: Transfer = { kind: "in", ep, length };
    this.log.push(t);
    this.maybeFail(t);
    if (this.hangIn) {
      return new Promise<USBInTransferResult>((_, reject) => this.pendingIn.push(reject));
    }
    return (
      this.inQueue.shift() ?? {
        status: "ok" as const,
        data: new DataView(new ArrayBuffer(0)),
      }
    );
  }
}

const asUsb = (d: FakeUsbDevice) => d as unknown as USBDevice;

/** The command ids of every 32-byte PICOBOOT packet sent, in order. */
function commandIds(d: FakeUsbDevice): number[] {
  return d.log
    .filter(
      (t): t is Extract<Transfer, { kind: "out" }> =>
        t.kind === "out" && t.data.length === 32
    )
    .filter((t) => new DataView(t.data.buffer).getUint32(0, true) === PICOBOOT_MAGIC)
    .map((t) => t.data[8]);
}

function packetArgs(d: FakeUsbDevice, cmdId: number): Uint8Array[] {
  return d.log
    .filter(
      (t): t is Extract<Transfer, { kind: "out" }> =>
        t.kind === "out" && t.data.length === 32
    )
    .filter((t) => t.data[8] === cmdId)
    .map((t) => t.data.subarray(16, 16 + t.data[9]));
}

const u32 = (bytes: Uint8Array, off: number) =>
  new DataView(bytes.buffer, bytes.byteOffset).getUint32(off, true);

function image(ranges: { address: number; length: number }[]): Uf2Image {
  const rs = ranges.map((r) => ({
    address: r.address,
    data: new Uint8Array(r.length).fill(0xab),
  }));
  return {
    familyId: 0xe48bff56,
    ranges: rs,
    totalBytes: rs.reduce((n, r) => n + r.data.length, 0),
  };
}

describe("buildCommandPacket", () => {
  it("lays out the 32-byte little-endian command", () => {
    const pkt = buildCommandPacket(7, {
      id: PicobootCmd.WRITE,
      args: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      transferLength: 4096,
    });
    const v = new DataView(pkt.buffer);
    expect(pkt.length).toBe(32);
    expect(v.getUint32(0, true)).toBe(PICOBOOT_MAGIC);
    expect(v.getUint32(4, true)).toBe(7);
    expect(pkt[8]).toBe(PicobootCmd.WRITE);
    expect(pkt[9]).toBe(8);
    expect(v.getUint16(10, true)).toBe(0);
    expect(v.getUint32(12, true)).toBe(4096);
    expect([...pkt.subarray(16, 24)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...pkt.subarray(24)]).toEqual(new Array(8).fill(0));
  });

  it("rejects more than 16 argument bytes", () => {
    expect(() => buildCommandPacket(1, { id: 1, args: new Uint8Array(17) })).toThrow(
      RangeError
    );
  });
});

describe("classifyUsbDevice", () => {
  it("tells RP2040 and RP2350 bootloaders from anything else", () => {
    expect(classifyUsbDevice({ vendorId: 0x2e8a, productId: 0x0003 } as USBDevice)).toBe(
      "rp2040"
    );
    expect(classifyUsbDevice({ vendorId: 0x2e8a, productId: 0x000f } as USBDevice)).toBe(
      "rp2350"
    );
    expect(classifyUsbDevice({ vendorId: 0x2e8a, productId: 0xf00a } as USBDevice)).toBe(
      "not-bootsel"
    );
    expect(classifyUsbDevice({ vendorId: 0x1234, productId: 0x0003 } as USBDevice)).toBe(
      "not-bootsel"
    );
  });
});

describe("PicobootDevice.open", () => {
  it("claims the vendor interface, clears both endpoints and resets the interface", async () => {
    const d = new FakeUsbDevice();
    await PicobootDevice.open(asUsb(d));
    expect(d.opened).toBe(true);
    expect(d.log).toEqual([
      { kind: "claim", iface: 1 },
      { kind: "clear-halt", direction: "in", ep: 4 },
      { kind: "clear-halt", direction: "out", ep: 3 },
      { kind: "control-out", request: 0x41, index: 1 },
    ]);
  });

  it("closes the device again when there is no PICOBOOT interface", async () => {
    const d = new FakeUsbDevice();
    d.configuration = { interfaces: [] };
    await expect(PicobootDevice.open(asUsb(d))).rejects.toThrow(/No PICOBOOT interface/);
    expect(d.log).toContainEqual({ kind: "close" });
  });
});

describe("flashUf2", () => {
  it("erases and writes sector by sector, then reboots and releases the device", async () => {
    const d = new FakeUsbDevice();
    const dev = await PicobootDevice.open(asUsb(d));
    const progress: number[] = [];
    const log: string[] = [];
    await flashUf2(dev, image([{ address: BASE, length: 10 * 1024 }]), {
      onProgress: (p) => progress.push(p),
      onLog: (l) => log.push(l),
    });
    expect(log).toEqual([
      "Writing 1 range (10240 bytes) across 3 flash sectors",
      "Range 0x10000000 (10240 bytes)",
      "Taking exclusive access",
      "Leaving XIP",
      "Writing: 39%",
      "Writing: 79%",
      "Writing: 99%",
      "Rebooting into the firmware",
    ]);

    expect(commandIds(d)).toEqual([
      PicobootCmd.EXCLUSIVE_ACCESS,
      PicobootCmd.EXIT_XIP,
      PicobootCmd.FLASH_ERASE,
      PicobootCmd.WRITE,
      PicobootCmd.FLASH_ERASE,
      PicobootCmd.WRITE,
      PicobootCmd.FLASH_ERASE,
      PicobootCmd.WRITE,
      PicobootCmd.REBOOT,
    ]);
    const erases = packetArgs(d, PicobootCmd.FLASH_ERASE).map((a) => [
      u32(a, 0),
      u32(a, 4),
    ]);
    expect(erases).toEqual([
      [BASE, FLASH_SECTOR_SIZE],
      [BASE + 0x1000, FLASH_SECTOR_SIZE],
      [BASE + 0x2000, FLASH_SECTOR_SIZE],
    ]);
    const writes = packetArgs(d, PicobootCmd.WRITE).map((a) => [u32(a, 0), u32(a, 4)]);
    expect(writes).toEqual([
      [BASE, 4096],
      [BASE + 0x1000, 4096],
      [BASE + 0x2000, 2048],
    ]);
    // Each WRITE packet is followed by its payload of the announced length.
    const outs = d.log.filter(
      (t): t is Extract<Transfer, { kind: "out" }> => t.kind === "out"
    );
    expect(outs.filter((t) => t.data.length === 4096)).toHaveLength(2);
    expect(outs.filter((t) => t.data.length === 2048)).toHaveLength(1);
    expect(packetArgs(d, PicobootCmd.EXCLUSIVE_ACCESS).map((a) => a[0])).toEqual([1]);
    const [reboot] = packetArgs(d, PicobootCmd.REBOOT);
    expect([u32(reboot, 0), u32(reboot, 4), u32(reboot, 8)]).toEqual([0, 0, 500]);
    expect(progress[progress.length - 1]).toBe(100);
    expect(progress.every((p, i) => i === 0 || p >= progress[i - 1])).toBe(true);
    expect(d.log.slice(-2)).toEqual([{ kind: "release", iface: 1 }, { kind: "close" }]);
  });

  it("erases each sector once when a range starts mid-sector", async () => {
    const d = new FakeUsbDevice();
    const dev = await PicobootDevice.open(asUsb(d));
    await flashUf2(dev, image([{ address: BASE + 0x1100, length: 0x1000 }]), {
      onProgress: () => {},
    });
    const erases = packetArgs(d, PicobootCmd.FLASH_ERASE).map((a) => u32(a, 0));
    expect(erases).toEqual([BASE + 0x1000, BASE + 0x2000]);
    const writes = packetArgs(d, PicobootCmd.WRITE).map((a) => [u32(a, 0), u32(a, 4)]);
    expect(writes).toEqual([
      [BASE + 0x1100, 0xf00],
      [BASE + 0x2000, 0x100],
    ]);
  });

  it("keeps two ranges that share a sector from erasing each other", async () => {
    const d = new FakeUsbDevice();
    const dev = await PicobootDevice.open(asUsb(d));
    await flashUf2(
      dev,
      image([
        { address: BASE, length: 0x100 },
        { address: BASE + 0x800, length: 0x100 },
      ]),
      { onProgress: () => {} }
    );
    expect(packetArgs(d, PicobootCmd.FLASH_ERASE)).toHaveLength(1);
    expect(packetArgs(d, PicobootCmd.WRITE).map((a) => u32(a, 0))).toEqual([
      BASE,
      BASE + 0x800,
    ]);
  });

  it("pads a short last page with erased flash", async () => {
    const d = new FakeUsbDevice();
    const dev = await PicobootDevice.open(asUsb(d));
    const progress: number[] = [];
    await flashUf2(dev, image([{ address: BASE, length: 0x180 }]), {
      onProgress: (p) => progress.push(p),
    });
    // Padding must not count toward progress.
    expect(progress.slice(0, -1).every((p) => p <= 99)).toBe(true);
    expect(progress[progress.length - 1]).toBe(100);
    const writes = packetArgs(d, PicobootCmd.WRITE).map((a) => [u32(a, 0), u32(a, 4)]);
    expect(writes).toEqual([[BASE, 0x200]]);
    const payload = d.log.find(
      (t): t is Extract<Transfer, { kind: "out" }> =>
        t.kind === "out" && t.data.length === 0x200
    );
    expect(payload?.data[0x17f]).toBe(0xab);
    expect(payload?.data[0x180]).toBe(0xff);
    expect(payload?.data[0x1ff]).toBe(0xff);
  });

  it("refuses an image that targets RAM", async () => {
    const d = new FakeUsbDevice();
    const dev = await PicobootDevice.open(asUsb(d));
    await expect(
      flashUf2(dev, image([{ address: 0x20000000, length: 0x100 }]), {
        onProgress: () => {},
      })
    ).rejects.toThrow(/outside flash/);
    expect(d.log[d.log.length - 1]).toEqual({ kind: "close" });
  });

  it("closes the device to fail a transfer that hangs when aborted mid-flash", async () => {
    const d = new FakeUsbDevice();
    const dev = await PicobootDevice.open(asUsb(d));
    d.hangIn = true;
    const abort = new AbortController();
    const flash = flashUf2(dev, image([{ address: BASE, length: 0x100 }]), {
      onProgress: () => {},
      signal: abort.signal,
    });
    await new Promise((r) => setTimeout(r, 5));
    abort.abort();
    await expect(flash).rejects.toMatchObject({ name: "InvalidStateError" });
    expect(d.log.filter((t) => t.kind === "close")).toHaveLength(2);
    expect(commandIds(d)).not.toContain(PicobootCmd.REBOOT);
  });

  it("reports a device lost before the reboot packet went out", async () => {
    const d = new FakeUsbDevice();
    const dev = await PicobootDevice.open(asUsb(d));
    d.failOn = (t) =>
      t.kind === "out" && t.data.length === 32 && t.data[8] === PicobootCmd.REBOOT
        ? new DOMException("The device was disconnected.", "NetworkError")
        : null;
    await expect(
      flashUf2(dev, image([{ address: BASE, length: 0x100 }]), { onProgress: () => {} })
    ).rejects.toMatchObject({ name: "NetworkError" });
  });

  it("treats a short bulk write as a failure", async () => {
    const d = new FakeUsbDevice();
    const dev = await PicobootDevice.open(asUsb(d));
    d.shortWrite = true;
    await expect(
      flashUf2(dev, image([{ address: BASE, length: 0x100 }]), { onProgress: () => {} })
    ).rejects.toThrow(/Short USB write/);
  });

  it("stops before erasing on an aborted signal and releases exclusive access", async () => {
    const d = new FakeUsbDevice();
    const dev = await PicobootDevice.open(asUsb(d));
    const abort = new AbortController();
    abort.abort();
    await expect(
      flashUf2(dev, image([{ address: BASE, length: 0x1000 }]), {
        onProgress: () => {},
        signal: abort.signal,
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    const ids = commandIds(d);
    expect(ids).not.toContain(PicobootCmd.FLASH_ERASE);
    expect(ids).not.toContain(PicobootCmd.REBOOT);
    expect(packetArgs(d, PicobootCmd.EXCLUSIVE_ACCESS).map((a) => a[0])).toEqual([1, 0]);
    expect(d.log[d.log.length - 1]).toEqual({ kind: "close" });
  });

  it("decodes a stalled command into a PicobootError after recovering the interface", async () => {
    const d = new FakeUsbDevice();
    const dev = await PicobootDevice.open(asUsb(d));
    d.log = [];
    // EXCLUSIVE ok, EXIT_XIP ok, first erase stalls with BAD_ALIGNMENT (5).
    d.inQueue = [
      { status: "ok", data: new DataView(new ArrayBuffer(0)) },
      { status: "ok", data: new DataView(new ArrayBuffer(0)) },
      { status: "stall", data: new DataView(new ArrayBuffer(0)) },
    ];
    const status = new DataView(d.statusResponse.buffer);
    status.setUint32(4, 5, true);
    status.setUint8(8, PicobootCmd.FLASH_ERASE);

    const err = await flashUf2(dev, image([{ address: BASE, length: 0x100 }]), {
      onProgress: () => {},
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PicobootError);
    expect((err as PicobootError).statusCode).toBe(5);
    expect((err as PicobootError).cmdId).toBe(PicobootCmd.FLASH_ERASE);
    expect((err as Error).message).toContain("BAD_ALIGNMENT");
    const recovery = d.log.filter(
      (t) =>
        t.kind === "clear-halt" || t.kind === "control-out" || t.kind === "control-in"
    );
    // The release of exclusive access on the way out succeeds, so only one recovery.
    expect(recovery.map((t) => t.kind)).toEqual([
      "clear-halt",
      "clear-halt",
      "control-out",
      "control-in",
    ]);
    expect(d.log[d.log.length - 1]).toEqual({ kind: "close" });
  });

  it("surfaces a device lost during stall recovery instead of a status of -1", async () => {
    const d = new FakeUsbDevice();
    const dev = await PicobootDevice.open(asUsb(d));
    d.inQueue = [{ status: "stall", data: new DataView(new ArrayBuffer(0)) }];
    d.failOn = (t) =>
      t.kind === "control-in"
        ? new DOMException("The device was disconnected.", "NetworkError")
        : null;
    await expect(
      flashUf2(dev, image([{ address: BASE, length: 0x100 }]), { onProgress: () => {} })
    ).rejects.toMatchObject({ name: "NetworkError" });
  });

  it("stamps serial activity for the reboot's re-enumeration", async () => {
    const d = new FakeUsbDevice();
    const dev = await PicobootDevice.open(asUsb(d));
    // The stamp is module state: jump the clock so earlier tests' stamps are stale.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 1_000_000);
    try {
      expect(isRecentSerialActivity()).toBe(false);
      await dev.reboot();
      expect(isRecentSerialActivity()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reboots an RP2350 with REBOOT2, which replaced REBOOT on that chip", async () => {
    const d = new FakeUsbDevice();
    d.productId = 0x000f;
    const dev = await PicobootDevice.open(asUsb(d));
    await dev.reboot();
    expect(packetArgs(d, PicobootCmd.REBOOT)).toHaveLength(0);
    const [reboot2] = packetArgs(d, PicobootCmd.REBOOT2);
    // flags (normal boot), delay, two unused params
    expect([u32(reboot2, 0), u32(reboot2, 4), u32(reboot2, 8), u32(reboot2, 12)]).toEqual(
      [0, 500, 0, 0]
    );
  });

  it("treats the device vanishing on the reboot ACK as success", async () => {
    const d = new FakeUsbDevice();
    const dev = await PicobootDevice.open(asUsb(d));
    d.failOn = (t) =>
      t.kind === "in" && commandIds(d)[commandIds(d).length - 1] === PicobootCmd.REBOOT
        ? new DOMException("The device was disconnected.", "NetworkError")
        : null;
    const progress: number[] = [];
    await flashUf2(dev, image([{ address: BASE, length: 0x100 }]), {
      onProgress: (p) => progress.push(p),
    });
    expect(progress[progress.length - 1]).toBe(100);
  });

  it("surfaces a lost device during a write and still closes", async () => {
    const d = new FakeUsbDevice();
    const dev = await PicobootDevice.open(asUsb(d));
    d.failOn = (t) =>
      t.kind === "out" && t.data.length === 0x1000
        ? new DOMException("The device was disconnected.", "NetworkError")
        : null;
    await expect(
      flashUf2(dev, image([{ address: BASE, length: 0x1000 }]), { onProgress: () => {} })
    ).rejects.toMatchObject({ name: "NetworkError" });
    expect(d.log[d.log.length - 1]).toEqual({ kind: "close" });
  });
});

describe("PicobootDevice guards", () => {
  it("rejects misaligned erase and write requests before touching the device", async () => {
    const d = new FakeUsbDevice();
    const dev = await PicobootDevice.open(asUsb(d));
    expect(() => dev.flashErase(BASE + 1, FLASH_SECTOR_SIZE)).toThrow(RangeError);
    expect(() => dev.write(BASE, new Uint8Array(100))).toThrow(RangeError);
  });
});
