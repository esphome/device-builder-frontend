import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import {
  buildHciPacket,
  crc16Nordic,
  flashDfuPackage,
  flashDfuPackageWithReconnect,
  parseDfuPackage,
  slipDecode,
  slipEncode,
} from "../../src/util/nrf-dfu.js";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("crc16Nordic", () => {
  it("matches CRC-16/CCITT-FALSE (adafruit-nrfutil's crc16)", () => {
    // Standard check value for CRC-16/CCITT-FALSE: "123456789" -> 0x29B1.
    expect(crc16Nordic(strToU8("123456789"))).toBe(0x29b1);
  });

  it("returns the initial value for empty input", () => {
    expect(crc16Nordic(bytes())).toBe(0xffff);
  });
});

describe("SLIP framing", () => {
  it("escapes END and ESC bytes", () => {
    expect([...slipEncode(bytes(0x01, 0xc0, 0x02, 0xdb, 0x03))]).toEqual([
      0x01, 0xdb, 0xdc, 0x02, 0xdb, 0xdd, 0x03,
    ]);
  });

  it("round-trips arbitrary payloads", () => {
    const payload = bytes(0xc0, 0xdb, 0xdc, 0xdd, 0x00, 0xff, 0xc0);
    expect([...slipDecode(slipEncode(payload))]).toEqual([...payload]);
  });

  it("rejects a truncated escape sequence", () => {
    expect(() => slipDecode(bytes(0x01, 0xdb))).toThrow(/Truncated/);
  });
});

describe("buildHciPacket", () => {
  it("frames a reliable HCI packet with header checksum and CRC", () => {
    const data = bytes(0x04, 0x00, 0x00, 0x00, 0xc0, 0xaa);
    const seq = 5;
    const pkt = buildHciPacket(data, seq);

    // SLIP END on both sides; the body is SLIP-encoded.
    expect(pkt[0]).toBe(0xc0);
    expect(pkt[pkt.length - 1]).toBe(0xc0);
    const body = slipDecode(pkt.subarray(1, pkt.length - 1));
    expect(body.length).toBe(4 + data.length + 2);

    // Header: seq | ack<<3 | integrity<<6 | reliable<<7, type 14 + 12-bit length,
    // then a checksum so the four bytes sum to zero.
    expect(body[0]).toBe(seq | (((seq + 1) % 8) << 3) | (1 << 6) | (1 << 7));
    expect(body[1]).toBe(14 | ((data.length & 0x0f) << 4));
    expect(body[2]).toBe((data.length & 0x0ff0) >> 4);
    expect((body[0] + body[1] + body[2] + body[3]) & 0xff).toBe(0);

    expect([...body.subarray(4, 4 + data.length)]).toEqual([...data]);
    const crc = crc16Nordic(body.subarray(0, 4 + data.length));
    expect(body[body.length - 2]).toBe(crc & 0xff);
    expect(body[body.length - 1]).toBe((crc >> 8) & 0xff);
  });

  it("wraps the sequence number modulo 8", () => {
    const body = slipDecode(buildHciPacket(bytes(0x01), 7).subarray(1, -1));
    expect(body[0] & 0x07).toBe(7);
    expect((body[0] >> 3) & 0x07).toBe(0);
  });
});

function dfuZip(
  manifest: Record<string, unknown>,
  files: Record<string, Uint8Array> = {}
): Uint8Array {
  return zipSync({
    "manifest.json": strToU8(JSON.stringify({ manifest })),
    ...files,
  });
}

describe("parseDfuPackage", () => {
  const app = bytes(1, 2, 3, 4);
  const dat = bytes(9, 9);

  it("extracts an application-only package", () => {
    const pkg = parseDfuPackage(
      dfuZip(
        { application: { bin_file: "app.bin", dat_file: "app.dat" } },
        { "app.bin": app, "app.dat": dat }
      )
    );
    expect(pkg.parts).toHaveLength(1);
    expect(pkg.parts[0].type).toBe("application");
    expect(pkg.parts[0].mode).toBe(4);
    expect([...pkg.parts[0].bin]).toEqual([...app]);
    expect([...pkg.parts[0].dat]).toEqual([...dat]);
  });

  it("orders softdevice+bootloader before the application and keeps its sizes", () => {
    const sdbl = bytes(0, 0, 0, 0, 0, 0);
    const pkg = parseDfuPackage(
      dfuZip(
        {
          application: { bin_file: "app.bin", dat_file: "app.dat" },
          softdevice_bootloader: {
            bin_file: "sdbl.bin",
            dat_file: "sdbl.dat",
            info_read_only_metadata: { sd_size: 4, bl_size: 2 },
          },
        },
        { "app.bin": app, "app.dat": dat, "sdbl.bin": sdbl, "sdbl.dat": dat }
      )
    );
    expect(pkg.parts.map((p) => p.type)).toEqual([
      "softdevice+bootloader",
      "application",
    ]);
    expect(pkg.parts[0].mode).toBe(3);
    expect(pkg.parts[0].sdSize).toBe(4);
    expect(pkg.parts[0].blSize).toBe(2);
  });

  it("rejects a zip without manifest.json", () => {
    expect(() => parseDfuPackage(zipSync({ "app.bin": app }))).toThrow(/manifest\.json/);
  });

  it("rejects a manifest that names a missing file", () => {
    expect(() =>
      parseDfuPackage(
        dfuZip(
          { application: { bin_file: "app.bin", dat_file: "app.dat" } },
          { "app.bin": app }
        )
      )
    ).toThrow(/app\.dat/);
  });

  it("rejects a manifest with no firmware entries", () => {
    expect(() => parseDfuPackage(dfuZip({}))).toThrow(/No firmware/);
  });

  it("rejects something that is not a zip", () => {
    expect(() => parseDfuPackage(bytes(1, 2, 3))).toThrow();
  });
});

describe("flashDfuPackage", () => {
  it("stops on abort and releases the port", async () => {
    const port = {
      open: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      readable: new ReadableStream<Uint8Array>(),
      writable: new WritableStream<Uint8Array>(),
    } as unknown as SerialPort;
    const pkg = {
      parts: [
        { type: "application" as const, mode: 4, bin: bytes(1, 2, 3), dat: bytes(0) },
      ],
    };
    const abort = new AbortController();
    abort.abort();

    await expect(
      flashDfuPackage(port, pkg, () => {}, abort.signal)
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(port.close).toHaveBeenCalled();
  });

  it("fails fast with the read error when the port drops mid-flash", async () => {
    const port = {
      open: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      // The device vanishes: reads end immediately, writes still succeed.
      readable: new ReadableStream<Uint8Array>({ start: (c) => c.close() }),
      writable: new WritableStream<Uint8Array>(),
    } as unknown as SerialPort;
    const pkg = {
      parts: [
        { type: "application" as const, mode: 4, bin: bytes(1, 2, 3), dat: bytes(0) },
      ],
    };

    await expect(flashDfuPackage(port, pkg, () => {})).rejects.toThrow(
      /Serial port closed/
    );
    expect(port.close).toHaveBeenCalled();
  });

  it("interrupts a stalled write on abort", async () => {
    const port = {
      open: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      readable: new ReadableStream<Uint8Array>(),
      // A write that only settles when the stream is aborted, as Chromium's
      // serial sink does when the device is unplugged mid-flash.
      writable: new WritableStream<Uint8Array>({
        write: (_chunk, controller) =>
          new Promise<void>((_, reject) => {
            controller.signal.addEventListener("abort", () =>
              reject(controller.signal.reason)
            );
          }),
      }),
    } as unknown as SerialPort;
    const pkg = {
      parts: [
        { type: "application" as const, mode: 4, bin: bytes(1, 2, 3), dat: bytes(0) },
      ],
    };
    const abort = new AbortController();

    const flash = flashDfuPackage(port, pkg, () => {}, abort.signal);
    await new Promise((r) => setTimeout(r, 10));
    abort.abort();

    await expect(flash).rejects.toMatchObject({ name: "AbortError" });
    expect(port.close).toHaveBeenCalled();
  });
});

describe("flashDfuPackageWithReconnect", () => {
  const droppedPort = () =>
    ({
      getInfo: () => ({ usbVendorId: 0x239a, usbProductId: 0x0029 }),
      open: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      readable: new ReadableStream<Uint8Array>({ start: (c) => c.close() }),
      writable: new WritableStream<Uint8Array>(),
    }) as unknown as SerialPort;
  const pkg = {
    parts: [
      { type: "application" as const, mode: 4, bin: bytes(1, 2, 3), dat: bytes(0) },
    ],
  };

  it("retries once through the reacquired handle when the device drops", async () => {
    const port = droppedPort();
    const onReconnecting = vi.fn();
    await expect(
      flashDfuPackageWithReconnect(port, pkg, () => {}, { onReconnecting })
    ).rejects.toThrow(/Serial port closed/);
    expect(onReconnecting).toHaveBeenCalledTimes(1);
    // Two attempts: the first open plus the reacquired handle, closed after each.
    expect(port.close).toHaveBeenCalledTimes(2);
  });

  it("does not retry after an abort", async () => {
    const port = droppedPort();
    const abort = new AbortController();
    abort.abort();
    const onReconnecting = vi.fn();
    await expect(
      flashDfuPackageWithReconnect(port, pkg, () => {}, {
        signal: abort.signal,
        onReconnecting,
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(onReconnecting).not.toHaveBeenCalled();
  });
});
