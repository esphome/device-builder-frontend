import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BOOT_BANNER_MS,
  matchBootBanner,
  readBootBanner,
} from "../../src/platforms/boot-banner.js";

// Captured on the bench (#1866): a plain RTS pulse with DTR released, 115200.
const RTL_PLAIN = `
== Rtl8710c IoT Platform ==
Chip VID: 5, Ver: 1
ROM Version: v2.1

== Boot Loader ==
Jul 20 2022:18:22:42

Boot Loader <==

== RAM Start ==
\u001b[1;32mI [      0.000] \u001b[0mLibreTiny v1.13.0+sha.6514b26 on bw15, compiled at Sep 25 2026 15:55:36, GCC 10.3.a (-Os)
\u001b[0;32m[I][logger:049]: Log initialized\u001b[0m
`;
const RTL_DOWNLOAD_MODE = `
== Rtl8710c IoT Platform ==
Chip VID: 5, Ver: 1
ROM Version: v2.1
Test Mode: boot_cfg1=0x20
Download Image over UART2[tx=16,rx=15] baud=115200
`;
const ESP32 = `ets Jun  8 2016 00:22:57

rst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)
configsip: 188777542, SPIWP:0xee
mode:DIO, clock div:2
load:0x3fff0030,len:6248
entry 0x40080638
I (29) boot: ESP-IDF 5.5.4 2nd stage bootloader
I (30) boot.esp32: SPI Speed      : 40MHz
`;
// The ESP8266 ROM speaks at 74880, so at 115200 it is noise before ESPHome's log.
const ESP8266 =
  "rl l�r$�n�l�b|���rb�b�nnlnnbbp�$blrlp\u001b[0;32m[I][logger:032]: Log initialized\u001b[0m\n";

describe("matchBootBanner", () => {
  it("names the RTL8720C from the ROM, and the board from LibreTiny", () => {
    expect(matchBootBanner(RTL_PLAIN)).toEqual({
      platform: "rtl87xx",
      mcu: "rtl8720c",
      board: "bw15",
    });
  });

  it("still names the RTL8720C when the reset landed in download mode", () => {
    expect(matchBootBanner(RTL_DOWNLOAD_MODE)).toEqual({
      platform: "rtl87xx",
      mcu: "rtl8720c",
    });
  });

  it("names a LibreTiny board on its own, leaving the family to the catalog", () => {
    expect(
      matchBootBanner("LibreTiny v1.13.0+sha.6514b26 on cb3s, compiled at ...")
    ).toEqual({
      board: "cb3s",
    });
  });

  it("says an ESP32 family ROM is esptool's, from the reset line or the IDF bootloader", () => {
    expect(matchBootBanner(ESP32)).toEqual({ platform: "esp" });
    expect(matchBootBanner("I (29) boot: ESP-IDF 5.5.4 2nd stage bootloader")).toEqual({
      platform: "esp",
    });
  });

  it("matches nothing in the ESP8266's 74880-baud noise, or in silence", () => {
    expect(matchBootBanner(ESP8266)).toBeNull();
    expect(matchBootBanner("")).toBeNull();
  });
});

/** A port whose readable stream plays ``chunks`` once the reset is released. */
function fakePort(chunks: string[], opts: { noSignals?: boolean } = {}) {
  const enc = new TextEncoder();
  const signals: SerialOutputSignals[] = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const raw = {
    readable: null as ReadableStream<Uint8Array> | null,
    open: vi.fn(async () => {
      raw.readable = new ReadableStream<Uint8Array>({
        start: (c) => {
          controller = c;
        },
      });
    }),
    close: vi.fn(async () => {
      raw.readable = null;
    }),
    setSignals: vi.fn(async (s: SerialOutputSignals) => {
      if (opts.noSignals) throw new DOMException("no lines", "NetworkError");
      signals.push(s);
      if (s.requestToSend === false)
        for (const c of chunks) controller?.enqueue(enc.encode(c));
    }),
  };
  // Not the shared makeWebSerialPort: ``readable`` must be the live field the
  // open() above sets, not a copy taken at creation.
  return { port: raw as unknown as SerialPort, raw, signals };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("readBootBanner", () => {
  it("pulses reset with the strap released and names what the board prints", async () => {
    const { port, raw, signals } = fakePort([RTL_PLAIN]);
    const pending = readBootBanner(port);
    await vi.advanceTimersByTimeAsync(BOOT_BANNER_MS);
    expect(await pending).toEqual({
      platform: "rtl87xx",
      mcu: "rtl8720c",
      board: "bw15",
    });
    expect(raw.open).toHaveBeenCalledWith({ baudRate: 115200 });
    expect(signals).toEqual([
      { dataTerminalReady: false, requestToSend: true },
      { dataTerminalReady: false, requestToSend: false },
    ]);
    expect(raw.close).toHaveBeenCalledOnce();
  });

  it("stops early once the text is conclusive", async () => {
    const { port } = fakePort([ESP32]);
    const pending = readBootBanner(port);
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toEqual({ platform: "esp" });
  });

  it("is null for a silent board, and for an adapter without lines", async () => {
    const silent = fakePort([]);
    const pending = readBootBanner(silent.port);
    await vi.advanceTimersByTimeAsync(BOOT_BANNER_MS + 10);
    expect(await pending).toBeNull();
    expect(silent.raw.close).toHaveBeenCalledOnce();
    const noLines = fakePort([RTL_PLAIN], { noSignals: true });
    const p2 = readBootBanner(noLines.port);
    await vi.advanceTimersByTimeAsync(BOOT_BANNER_MS + 10);
    expect(await p2).toBeNull();
  });

  it("leaves the port alone once the deadline has passed, even when the pulse settles late", async () => {
    const { port, raw } = fakePort([RTL_PLAIN]);
    let releasePulse: () => void = () => {};
    raw.setSignals.mockImplementationOnce(
      () => new Promise<void>((r) => (releasePulse = r))
    );
    const pending = readBootBanner(port);
    const assertion = expect(pending).rejects.toThrow("Boot banner not read");
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
    expect(raw.close).toHaveBeenCalledOnce();
    // esptool may own the port now; the late pulse must not take its reader.
    raw.readable = { getReader: vi.fn() } as unknown as ReadableStream<Uint8Array>;
    releasePulse();
    await vi.advanceTimersByTimeAsync(10);
    expect(
      (raw.readable as unknown as { getReader: ReturnType<typeof vi.fn> }).getReader
    ).not.toHaveBeenCalled();
  });

  it("rejects when the port will not open", async () => {
    const { port, raw } = fakePort([]);
    raw.open.mockRejectedValue(new DOMException("held", "NetworkError"));
    await expect(readBootBanner(port)).rejects.toThrow("held");
    expect(raw.close).not.toHaveBeenCalled();
  });
});
