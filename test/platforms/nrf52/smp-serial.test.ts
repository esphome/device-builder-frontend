import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSmpFrame,
  parseMcubootImage,
} from "../../../src/platforms/nrf52/smp-protocol.js";
import {
  encodeSerialFrame,
  flashMcubootOverSerial,
  SmpSerialDecoder,
} from "../../../src/platforms/nrf52/smp-serial.js";
import { FakeSmpDevice } from "./_fake-smp-device.js";
import { makeMcubootImage } from "./_mcuboot-image.js";

const lines = (encoded: Uint8Array): Uint8Array[] => {
  const out: Uint8Array[] = [];
  let start = 0;
  encoded.forEach((byte, i) => {
    if (byte !== 0x0a) return;
    out.push(encoded.slice(start, i));
    start = i + 1;
  });
  return out;
};

function decode(...chunks: Uint8Array[]): Uint8Array[] {
  const frames: Uint8Array[] = [];
  const decoder = new SmpSerialDecoder((frame) => frames.push(frame));
  for (const chunk of chunks) decoder.push(chunk);
  return frames;
}

const ascii = (text: string) => new TextEncoder().encode(text);

describe("encodeSerialFrame", () => {
  it("wraps a frame in a length prefix and the CRC16 of its bytes", () => {
    // CRC16 (poly 0x1021, init 0) of "123456789" is 0x31c3.
    const [line] = lines(encodeSerialFrame(ascii("123456789")));
    expect([...line.slice(0, 2)]).toEqual([0x06, 0x09]);
    const raw = atob(new TextDecoder().decode(line.slice(2)));
    expect([...raw].map((c) => c.charCodeAt(0))).toEqual([
      0x00,
      11,
      ...ascii("123456789"),
      0x31,
      0xc3,
    ]);
  });

  it("gives an empty frame a zero CRC", () => {
    const [line] = lines(encodeSerialFrame(new Uint8Array(0)));
    const raw = atob(new TextDecoder().decode(line.slice(2)));
    expect([...raw].map((c) => c.charCodeAt(0))).toEqual([0x00, 2, 0x00, 0x00]);
  });

  it("splits a long frame into lines the device's buffer takes", () => {
    const frame = buildSmpFrame(2, 1, 1, 0, { data: new Uint8Array(300), off: 0 });
    const encoded = lines(encodeSerialFrame(frame));
    expect(encoded.length).toBeGreaterThan(1);
    expect([...encoded[0].slice(0, 2)]).toEqual([0x06, 0x09]);
    for (const line of encoded.slice(1)) {
      expect([...line.slice(0, 2)]).toEqual([0x04, 0x14]);
    }
    // Two marker bytes, the base64 and the newline, in a 128-byte buffer.
    for (const line of encoded) expect(line.length + 1).toBeLessThanOrEqual(128);
  });
});

describe("SmpSerialDecoder", () => {
  const frame = buildSmpFrame(3, 1, 1, 4, { rc: 0, off: 4096 });
  const long = buildSmpFrame(3, 1, 0, 5, { data: new Uint8Array(400).fill(7) });

  it.each([
    ["a single-line frame", frame],
    ["a frame split across lines", long],
  ])("reassembles %s", (_name, sent) => {
    expect(decode(encodeSerialFrame(sent))).toEqual([sent]);
  });

  it("reassembles a frame that arrives a byte at a time", () => {
    const bytes = [...encodeSerialFrame(long)].map((b) => new Uint8Array([b]));
    expect(decode(...bytes)).toEqual([long]);
  });

  it("decodes frames back to back", () => {
    expect(decode(encodeSerialFrame(frame), encodeSerialFrame(long))).toEqual([
      frame,
      long,
    ]);
  });

  it("ignores the shell's own output around a frame", () => {
    expect(
      decode(
        ascii("[00:00:01.000] <inf> app: heartbeat\n"),
        encodeSerialFrame(frame),
        ascii("uart:~$ \n")
      )
    ).toEqual([frame]);
  });

  it("drops a frame that fails its CRC", () => {
    const encoded = encodeSerialFrame(frame);
    // Inside the base64 body, past the markers and the length prefix.
    encoded[10] = encoded[10] === 0x41 ? 0x42 : 0x41;
    expect(decode(encoded, encodeSerialFrame(long))).toEqual([long]);
  });

  it("drops a continuation with no start before it", () => {
    const [, continuation] = lines(encodeSerialFrame(long));
    expect(
      decode(new Uint8Array([...continuation, 0x0a]), encodeSerialFrame(frame))
    ).toEqual([frame]);
  });

  it("starts over when a new frame interrupts a partial one", () => {
    const [first] = lines(encodeSerialFrame(long));
    expect(decode(new Uint8Array([...first, 0x0a]), encodeSerialFrame(frame))).toEqual([
      frame,
    ]);
  });
});

/** A serial port in front of a ``FakeSmpDevice``, speaking the mcumgr framing. */
function makePort({
  smp = new FakeSmpDevice(),
  silent = false,
  strayReply = false,
}: { smp?: FakeSmpDevice; silent?: boolean; strayReply?: boolean } = {}) {
  let rx!: ReadableStreamDefaultController<Uint8Array>;
  const decoder = new SmpSerialDecoder((frame) => {
    if (silent) return;
    void smp.exchange(frame).then((reply) => {
      if (strayReply) {
        // A late answer to an earlier request, numbered differently.
        const stray = reply.slice();
        stray[6] = (reply[6] + 100) & 0xff;
        rx.enqueue(encodeSerialFrame(stray));
      }
      rx.enqueue(encodeSerialFrame(reply));
    });
  });
  let open = false;
  const port = {
    get readable() {
      return open ? readable : null;
    },
    get writable() {
      return open ? writable : null;
    },
    open: vi.fn(async () => {
      open = true;
    }),
    close: vi.fn(async () => {
      open = false;
    }),
  };
  const readable = new ReadableStream<Uint8Array>({ start: (c) => (rx = c) });
  const writable = new WritableStream<Uint8Array>({
    write: (bytes) => decoder.push(bytes),
  });
  return { port: port as unknown as SerialPort, mock: port, smp };
}

async function flashOverSerial(fake: ReturnType<typeof makePort>, bodySize = 300) {
  const image = await parseMcubootImage(makeMcubootImage({ bodySize }));
  const done = flashMcubootOverSerial(fake.port, image, { onProgress: () => {} });
  done.catch(() => {});
  await vi.runAllTimersAsync();
  return { done, image };
}

describe("flashMcubootOverSerial", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uploads the image at 115200 baud and closes the port", async () => {
    const fake = makePort();
    const { done, image } = await flashOverSerial(fake);
    await done;

    expect(fake.mock.open).toHaveBeenCalledWith({ baudRate: 115200 });
    expect(fake.smp.received).toEqual(image.bytes);
    expect(fake.mock.close).toHaveBeenCalled();
  });

  it("takes only the reply numbered for the request it sent", async () => {
    const fake = makePort({ strayReply: true });
    const { done, image } = await flashOverSerial(fake);
    await done;

    expect(fake.smp.received).toEqual(image.bytes);
  });

  it("closes the port when its streams cannot be taken", async () => {
    const fake = makePort();
    // As a port whose reader is still locked by an earlier session.
    fake.mock.open.mockImplementation(async () => {});
    const { done } = await flashOverSerial(fake);

    await expect(done).rejects.toThrow();
    expect(fake.mock.close).toHaveBeenCalled();
  });

  it("fails when the device never answers, and closes the port", async () => {
    const fake = makePort({ silent: true });
    const { done } = await flashOverSerial(fake);

    await expect(done).rejects.toThrow("no response from the device");
    expect(fake.mock.close).toHaveBeenCalled();
  });
});
