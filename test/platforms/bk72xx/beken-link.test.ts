import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driveFakeTimers } from "../../_fake-timers.js";
import { disconnectEvents } from "../../_web-serial.js";
import {
  BekenLink,
  BekenResponseError,
  releaseLines,
  resetOverLines,
} from "../../../src/platforms/bk72xx/beken-link.js";
import {
  checkCrc,
  flashEraseSector,
  flashWrite4k,
  reboot,
} from "../../../src/platforms/bk72xx/beken-packets.js";
import { SerialDeviceLostError } from "../../../src/util/serial-open-error.js";

/** A port that answers every command frame with what the test scripted for it. */
function scripted(answers: (number[] | null)[]) {
  let out!: ReadableStreamDefaultController<Uint8Array>;
  const sent: Uint8Array[] = [];
  const writes: number[] = [];
  const rx: number[] = [];
  // A frame arrives in paced chunks; an answer goes out once it is whole.
  const frameLength = (): number | null => {
    if (rx.length < 5) return null;
    if (rx[3] !== 0xff) return 4 + rx[3];
    if (rx.length < 8) return null;
    return 7 + (rx[5] | (rx[6] << 8));
  };
  const port = {
    ...disconnectEvents(),
    readable: new ReadableStream<Uint8Array>({ start: (c) => (out = c) }),
    writable: new WritableStream<Uint8Array>({
      write: (chunk) => {
        writes.push(chunk.length);
        rx.push(...chunk);
        for (let length = frameLength(); length !== null && rx.length >= length;) {
          sent.push(new Uint8Array(rx.splice(0, length)));
          length = frameLength();
          const answer = answers.shift();
          if (answer) out.enqueue(new Uint8Array(answer));
        }
      },
    }),
    setSignals: vi.fn(async (_s: SerialOutputSignals) => {}),
  };
  const link = new BekenLink(port as unknown as SerialPort);
  return {
    link,
    port,
    sent,
    writes,
    /** Bytes that arrive by themselves, not as the answer to a write. */
    arrive: (bytes: number[]) => out.enqueue(new Uint8Array(bytes)),
    drop: () => out.close(),
  };
}

const CRC = [0x04, 0x0e, 0x08, 0x01, 0xe0, 0xfc, 0x10, 0x78, 0x56, 0x34, 0x12];
const LINKED = [0x04, 0x0e, 0x05, 0x01, 0xe0, 0xfc, 0x01, 0x00];
const erased = (...echo: number[]) => [
  ...[0x04, 0x0e, 0xff, 0x01, 0xe0, 0xfc, 0xf4, 0x07, 0x00, 0x0f, 0x00],
  ...echo,
];
const ERASE = flashEraseSector(0x211000);
const ERASED = erased(0x20, 0x00, 0x10, 0x21, 0x00);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("BekenLink.command", () => {
  it("returns the payload of a short response", async () => {
    const { link, sent } = scripted([CRC]);

    const payload = await driveFakeTimers(link.command(checkCrc(0, 256)));

    expect([...payload]).toEqual([0x78, 0x56, 0x34, 0x12]);
    expect(sent).toHaveLength(1);
  });

  it("returns the payload of a long response", async () => {
    const { link } = scripted([ERASED]);

    const payload = await driveFakeTimers(link.command(ERASE));

    expect([...payload]).toEqual([0x00, 0x20, 0x00, 0x10, 0x21, 0x00]);
  });

  it("takes a response that is in already, however late it is read", async () => {
    const { link } = scripted([CRC]);

    // No time left at all, as after a page that stalled past the deadline.
    const payload = await driveFakeTimers(link.command(checkCrc(0, 256), 0));

    expect([...payload]).toEqual([0x78, 0x56, 0x34, 0x12]);
  });

  it("does not wait for a command that has no response", async () => {
    const { link } = scripted([null]);

    expect(await link.command(reboot())).toHaveLength(0);
  });

  it("reads past bytes that are no response, and takes one that comes in pieces", async () => {
    const { link, arrive } = scripted([[0x00, 0xff, 0x04, ...CRC.slice(0, 5)]]);
    const done = link.command(checkCrc(0, 256));
    await vi.advanceTimersByTimeAsync(300);

    // The rest arrives before the command's second is over.
    arrive(CRC.slice(5));

    expect([...(await driveFakeTimers(done))]).toEqual([0x78, 0x56, 0x34, 0x12]);
  });

  it.each([
    ["a long response to a short command", [0x04, 0x0e, 0xff, ...CRC]],
    ["a header with something in it", [0x04, 0x0e, 0x08, 0x00, 0x01, 0xe0, 0xfc, ...CRC]],
    ["the response of another command", [...LINKED, ...CRC]],
  ])("skips %s", async (_name, bytes) => {
    const { link } = scripted([bytes]);

    const payload = await driveFakeTimers(link.command(checkCrc(0, 256)));

    expect([...payload]).toEqual([0x78, 0x56, 0x34, 0x12]);
  });

  it.each([
    ["a short response to a long command", [...CRC, ...ERASED]],
    [
      "a long header with something before its mark",
      [0x04, 0x0e, 0xff, 0x01, 0xe0, 0xfc, 0x00, 0xf4, ...ERASED],
    ],
  ])("skips %s", async (_name, bytes) => {
    const { link } = scripted([bytes]);

    const payload = await driveFakeTimers(link.command(ERASE));

    expect(payload).toHaveLength(6);
  });

  it("fails when nothing comes back", async () => {
    const { link } = scripted([null]);

    const done = link.command(checkCrc(0, 256));
    done.catch(() => {});

    await expect(driveFakeTimers(done)).rejects.toThrow("No response received");
    await expect(done).rejects.toBeInstanceOf(BekenResponseError);
  });

  it("fails on a response that stops short", async () => {
    const { link } = scripted([CRC.slice(0, 9)]);

    const done = link.command(checkCrc(0, 256));
    done.catch(() => {});

    await expect(driveFakeTimers(done)).rejects.toThrow("Incomplete response");
    await expect(done).rejects.toBeInstanceOf(BekenResponseError);
  });

  it("fails on the response to another address", async () => {
    const { link } = scripted([erased(0x20, 0x00, 0x20, 0x21, 0x00)]);

    const done = link.command(ERASE);
    done.catch(() => {});

    await expect(driveFakeTimers(done)).rejects.toThrow(
      "FlashErase: the response is for another"
    );
  });

  it("fails on a status that is not 0", async () => {
    const response = [
      ...[0x04, 0x0e, 0xff, 0x01, 0xe0, 0xfc, 0xf4, 0x06, 0x00, 0x07],
      ...[0x06, 0x00, 0x10, 0x21, 0x00],
    ];
    const { link } = scripted([response]);

    const done = link.command(flashWrite4k(0x211000, new Uint8Array(4096)));
    done.catch(() => {});

    await expect(driveFakeTimers(done)).rejects.toThrow("FlashWrite4K: status 6");
  });

  it.each([
    ["a length that is too small to be one", [0x04, 0x0e, 0x03, 0x01, 0xe0, 0xfc, 0x10]],
    [
      "fewer bytes than its command has",
      [0x04, 0x0e, 0x06, 0x01, 0xe0, 0xfc, 0x10, 1, 2],
    ],
  ])("fails on a response with %s", async (_name, bytes) => {
    const { link } = scripted([bytes]);

    const done = link.command(checkCrc(0, 256));
    done.catch(() => {});

    await expect(driveFakeTimers(done)).rejects.toThrow("Incomplete response");
    await expect(done).rejects.toBeInstanceOf(BekenResponseError);
  });

  it("finds a response that starts inside bytes that look like its header", async () => {
    // 04 04 0E: the first byte fits, the second starts the header anew.
    const { link } = scripted([[0x04, ...CRC]]);

    const payload = await driveFakeTimers(link.command(checkCrc(0, 256)));

    expect([...payload]).toEqual([0x78, 0x56, 0x34, 0x12]);
  });

  it("fails as a lost device when the port goes away in the middle of a response", async () => {
    const { link, drop } = scripted([CRC.slice(0, 9)]);
    const done = link.command(checkCrc(0, 256));
    done.catch(() => {});
    await vi.advanceTimersByTimeAsync(100);

    drop();

    await expect(driveFakeTimers(done)).rejects.toBeInstanceOf(SerialDeviceLostError);
  });

  it("gives up when its time is over although bytes keep arriving", async () => {
    const { link, arrive } = scripted([null]);
    const done = link.command(checkCrc(0, 256));
    done.catch(() => {});
    // A firmware that logs on this port: a byte every 100 ms, none a response.
    for (let i = 0; i < 15; i++) {
      await vi.advanceTimersByTimeAsync(100);
      arrive([0x55]);
    }

    await expect(driveFakeTimers(done)).rejects.toThrow("No response received");
    await expect(done).rejects.toBeInstanceOf(BekenResponseError);
  });

  it("waits for no more past its time, once what is in is read", async () => {
    const { link, arrive } = scripted([null]);
    const done = link.command(checkCrc(0, 256));
    done.catch(() => {});
    await vi.advanceTimersByTimeAsync(10);

    // The start of a response, with the clock past the command's time.
    arrive([0x55, ...CRC.slice(0, 6)]);
    vi.setSystemTime(Date.now() + 2000);

    await expect(driveFakeTimers(done)).rejects.toThrow("No response received");
  });

  it("gives up on a response that comes in slower than its time allows", async () => {
    const { link, arrive } = scripted([CRC.slice(0, 8)]);
    const done = link.command(checkCrc(0, 256));
    done.catch(() => {});
    for (const b of CRC.slice(8, 10)) {
      await vi.advanceTimersByTimeAsync(600);
      arrive([b]);
    }

    await expect(driveFakeTimers(done)).rejects.toThrow("Incomplete response");
  });

  it("waits as long as it is given", async () => {
    const { link, arrive } = scripted([null]);
    const done = link.command(checkCrc(0, 0x200000), 6000);
    await vi.advanceTimersByTimeAsync(5000);

    arrive(CRC);

    expect(await driveFakeTimers(done)).toHaveLength(4);
  });
});

describe("BekenLink.link", () => {
  it("is linked by the first answer", async () => {
    const { link, sent } = scripted([LINKED]);

    expect(await driveFakeTimers(link.link(2000))).toBe(true);
    expect(sent.map((s) => [...s])).toEqual([[0x01, 0xe0, 0xfc, 0x01, 0x00]]);
  });

  it("keeps sending until the chip answers", async () => {
    const { link, sent } = scripted([null, null, null, LINKED]);

    expect(await driveFakeTimers(link.link(2000))).toBe(true);
    expect(sent).toHaveLength(4);
  });

  it("is not linked by an answer that says so", async () => {
    const { link } = scripted([[0x04, 0x0e, 0x05, 0x01, 0xe0, 0xfc, 0x01, 0x01]]);

    expect(await driveFakeTimers(link.link(100))).toBe(false);
  });

  it("gives up when its time is over", async () => {
    const { link, sent } = scripted([]);

    expect(await driveFakeTimers(link.link(1000))).toBe(false);
    expect(sent.length).toBeGreaterThan(100);
  });

  it("does not wait for answers when every LinkCheck was answered", async () => {
    const { link } = scripted([LINKED]);
    const before = Date.now();

    await driveFakeTimers(link.link(2000));

    expect(Date.now() - before).toBeLessThan(20);
  });

  it("stops waiting for answers when its window is over", async () => {
    const { link, arrive } = scripted([null, LINKED]);
    const linking = link.link(2000);
    linking.catch(() => {});
    // Answers that keep coming, as from a chip that was sent many.
    for (let i = 0; i < 40; i++) {
      await vi.advanceTimersByTimeAsync(10);
      arrive(LINKED);
    }

    expect(await driveFakeTimers(linking)).toBe(true);
  });

  it("drops the answers that are still on their way once linked", async () => {
    const { link, arrive } = scripted([null, null, LINKED, CRC]);
    const linking = link.link(2000);
    await vi.advanceTimersByTimeAsync(12);
    // The answers to the first two come after the third was taken.
    arrive([...LINKED, ...LINKED]);
    expect(await driveFakeTimers(linking)).toBe(true);

    const payload = await driveFakeTimers(link.command(checkCrc(0, 256)));

    expect([...payload]).toEqual([0x78, 0x56, 0x34, 0x12]);
  });

  it("fails as a lost device when the port goes away", async () => {
    const { link, drop } = scripted([]);
    const done = link.link(2000);
    done.catch(() => {});
    await vi.advanceTimersByTimeAsync(100);

    drop();

    await expect(driveFakeTimers(done)).rejects.toBeInstanceOf(SerialDeviceLostError);
  });
});

describe("the adapter's lines", () => {
  it("releases both", async () => {
    const { port } = scripted([]);

    expect(await releaseLines(port as unknown as SerialPort)).toBe(true);
    expect(port.setSignals.mock.calls).toEqual([
      [{ dataTerminalReady: false, requestToSend: false }],
    ]);
  });

  it("resets as bk7231tools does: both held, DTR released, then RTS", async () => {
    const { port } = scripted([]);

    expect(await driveFakeTimers(resetOverLines(port as unknown as SerialPort))).toBe(
      true
    );
    expect(port.setSignals.mock.calls).toEqual([
      [{ dataTerminalReady: true, requestToSend: true }],
      [{ dataTerminalReady: false }],
      [{ requestToSend: false }],
    ]);
  });

  it("releases the lines when the reset fails on its way", async () => {
    const { port } = scripted([]);
    port.setSignals
      .mockImplementationOnce(async () => {})
      .mockRejectedValueOnce(new DOMException("gone", "NetworkError"));

    expect(await driveFakeTimers(resetOverLines(port as unknown as SerialPort))).toBe(
      false
    );
    expect(port.setSignals.mock.calls[port.setSignals.mock.calls.length - 1]).toEqual([
      { dataTerminalReady: false, requestToSend: false },
    ]);
  });

  it("says so when there are no lines to drive", async () => {
    const { port } = scripted([]);
    port.setSignals.mockRejectedValue(new DOMException("no lines", "NetworkError"));

    expect(await releaseLines(port as unknown as SerialPort)).toBe(false);
    expect(await resetOverLines(port as unknown as SerialPort)).toBe(false);
  });
});

describe("paced writes", () => {
  // One 128-byte chunk on the wire at 115200, rounded up.
  const PERIOD = 12;
  const WRITTEN = [
    ...[0x04, 0x0e, 0xff, 0x01, 0xe0, 0xfc, 0xf4, 0x06, 0x00, 0x07],
    ...[0x00, 0x00, 0x10, 0x01, 0x00],
  ];

  it("sends a long frame in chunks no faster than the wire drains them", async () => {
    const { link, sent, writes } = scripted([WRITTEN]);

    const done = link.command(flashWrite4k(0x11000, new Uint8Array(4096)));
    done.catch(() => {});

    // The first chunk goes out at once; a 4109-byte frame takes ~357 ms
    // at 115200, so at 200 ms the frame must still be on its way.
    await vi.advanceTimersByTimeAsync(0);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.length).toBeLessThan(10);
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(sent).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(200);
    expect(sent).toHaveLength(1);
    expect(Math.max(...writes)).toBeLessThanOrEqual(128);
    expect([...(await done)]).toEqual([0x00, 0x00, 0x10, 0x01, 0x00]);
  });

  it("writes a short frame whole, with nothing to wait on", async () => {
    const { link, writes } = scripted([CRC]);

    await driveFakeTimers(link.command(checkCrc(0, 256)));

    expect(writes).toEqual([13]);
  });

  it("does not burst the backlog after a stall", async () => {
    let out!: ReadableStreamDefaultController<Uint8Array>;
    const writes: number[] = [];
    let release!: () => void;
    let stallNext = false;
    const port = {
      ...disconnectEvents(),
      readable: new ReadableStream<Uint8Array>({ start: (c) => (out = c) }),
      writable: new WritableStream<Uint8Array>({
        write: (chunk: Uint8Array) => {
          writes.push(chunk.length);
          if (!stallNext) return undefined;
          stallNext = false;
          return new Promise<void>((r) => (release = r));
        },
      }),
      setSignals: vi.fn(async (_s: SerialOutputSignals) => {}),
    };
    void out;
    const link = new BekenLink(port as unknown as SerialPort);

    const done = link.command(flashWrite4k(0x11000, new Uint8Array(4096)));
    done.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    stallNext = true;
    await vi.advanceTimersByTimeAsync(PERIOD);
    const before = writes.length;

    // A long stall leaves a backlog behind the schedule.
    await vi.advanceTimersByTimeAsync(100);
    expect(writes.length).toBe(before);

    // Released, the pace starts over from here instead of catching up.
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(writes.length).toBe(before);
    await vi.advanceTimersByTimeAsync(PERIOD);
    expect(writes.length).toBe(before + 1);
  });

  it("fails between chunks when the device goes away", async () => {
    const { link, writes, drop } = scripted([WRITTEN]);

    const done = link.command(flashWrite4k(0x11000, new Uint8Array(4096)));
    const failed = expect(done).rejects.toBeInstanceOf(SerialDeviceLostError);
    await vi.advanceTimersByTimeAsync(0);
    const before = writes.length;

    drop();
    await vi.advanceTimersByTimeAsync(0);

    await failed;
    expect(writes.length).toBe(before);
  });
});
