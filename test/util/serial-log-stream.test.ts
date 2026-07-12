import { describe, expect, it, vi } from "vitest";

import {
  formatSerialTimestamp,
  streamSerialLines,
} from "../../src/util/serial-log-stream.js";

const enc = (s: string) => new TextEncoder().encode(s);
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeOpenPort(
  build: (controller: ReadableStreamDefaultController<Uint8Array>) => void
): {
  readable: ReadableStream<Uint8Array>;
  close: ReturnType<typeof vi.fn>;
} {
  return {
    readable: new ReadableStream<Uint8Array>({
      start(controller) {
        build(controller);
      },
    }),
    close: vi.fn(async () => {}),
  };
}

describe("formatSerialTimestamp", () => {
  it("renders a zero-padded local [HH:MM:SS] stamp", () => {
    expect(formatSerialTimestamp(new Date(2020, 0, 1, 9, 8, 7))).toBe("[09:08:07]");
    expect(formatSerialTimestamp(new Date(2020, 0, 1, 23, 0, 0))).toBe("[23:00:00]");
  });
});

describe("streamSerialLines", () => {
  it("stamps and emits complete lines, buffering the trailing fragment", async () => {
    const lines: string[] = [];
    const port = makeOpenPort((c) => {
      c.enqueue(enc("[I][app]: hello\nrest"));
      c.close();
    });
    streamSerialLines(port as unknown as SerialPort, { onLine: (l) => lines.push(l) });
    await flush();

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[\d{2}:\d{2}:\d{2}\]/);
    expect(lines[0]).toContain("hello");
  });

  it("strips a trailing CR from CRLF lines", async () => {
    const lines: string[] = [];
    const port = makeOpenPort((c) => {
      c.enqueue(enc("one\r\ntwo\r\n"));
      c.close();
    });
    streamSerialLines(port as unknown as SerialPort, { onLine: (l) => lines.push(l) });
    await flush();

    expect(lines).toHaveLength(2);
    expect(lines[0].endsWith("\r")).toBe(false);
    expect(lines[0]).toContain("one");
    expect(lines[1]).toContain("two");
  });

  it("drops mis-sampled garbage lines", async () => {
    const lines: string[] = [];
    const port = makeOpenPort((c) => {
      c.enqueue(enc("good line here\n������\n"));
      c.close();
    });
    streamSerialLines(port as unknown as SerialPort, { onLine: (l) => lines.push(l) });
    await flush();

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("good line here");
  });

  it("fires onDisconnect when the device ends the stream on its own", async () => {
    const port = makeOpenPort((c) => {
      c.enqueue(enc("boot\n"));
      c.close();
    });
    const onDisconnect = vi.fn();
    streamSerialLines(port as unknown as SerialPort, { onLine: () => {}, onDisconnect });
    await flush();

    expect(onDisconnect).toHaveBeenCalledOnce();
    expect(onDisconnect).toHaveBeenCalledWith(undefined);
  });

  it("fires onDisconnect with the error when the stream errors mid-read", async () => {
    const port = makeOpenPort((c) => {
      c.error(new Error("cable yanked"));
    });
    const onDisconnect = vi.fn();
    streamSerialLines(port as unknown as SerialPort, { onLine: () => {}, onDisconnect });
    await flush();

    expect(onDisconnect).toHaveBeenCalledOnce();
    expect(String(onDisconnect.mock.calls[0][0])).toContain("cable yanked");
  });

  it("does NOT fire onDisconnect on a caller-initiated cancel", async () => {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const port = makeOpenPort((c) => {
      ctrl = c;
    });
    const onDisconnect = vi.fn();
    const cancel = streamSerialLines(port as unknown as SerialPort, {
      onLine: () => {},
      onDisconnect,
    });
    await flush();
    cancel();
    await vi.waitFor(() => expect(port.close).toHaveBeenCalledOnce());

    expect(onDisconnect).not.toHaveBeenCalled();
    void ctrl;
  });

  it("cancel closes the port after the read loop releases the lock", async () => {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const port = makeOpenPort((c) => {
      ctrl = c;
    });
    const cancel = streamSerialLines(port as unknown as SerialPort, { onLine: () => {} });
    await flush();
    cancel();
    // cancel → await loopDone (releaseLock) → port.close(): several ticks.
    await vi.waitFor(() => expect(port.close).toHaveBeenCalledOnce());
    void ctrl;
  });
});
