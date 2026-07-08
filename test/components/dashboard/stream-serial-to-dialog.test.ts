/**
 * Tests for ``streamSerialToDialog`` — the helper that pipes Web
 * Serial output into the logs dialog's line buffer.
 *
 * The interesting behaviour is the timestamp prefix: ESPHome firmware
 * emits ``[LEVEL][component:line]: msg`` over UART without a wall-clock
 * timestamp; the Python ``esphome logs`` CLI prepends ``[HH:MM:SS]`` at
 * receive time. The Web Serial path used to drop those lines through
 * verbatim, which is what issue #338 reports. These tests pin the
 * receive-time stamp in place so the regression can't sneak back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamSerialToDialog } from "../../../src/components/dashboard/actions.js";
import { flushMicrotasks } from "../../_dom.js";

interface MockDialog {
  _lines: string[];
  _enqueueLine(line: string): void;
}

// The real dialog batches via requestAnimationFrame; for these decode-focused
// tests a synchronous push keeps the existing _lines assertions intact.
function mockDialog(): MockDialog {
  const d: MockDialog = {
    _lines: [],
    _enqueueLine(line: string) {
      d._lines.push(line);
    },
  };
  return d;
}

function encode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function createMockPort(chunks: Uint8Array[]) {
  let idx = 0;
  // Block forever once the script is exhausted so the loop stays
  // alive between explicit feed steps — the cancel returned by
  // ``streamSerialToDialog`` is what tears the loop down.
  let blockResolver: ((v: { value: undefined; done: true }) => void) | null = null;
  const reader = {
    read: vi.fn(async () => {
      if (idx < chunks.length) {
        return { value: chunks[idx++], done: false };
      }
      return new Promise<{ value: undefined; done: true }>((resolve) => {
        blockResolver = resolve;
      });
    }),
    cancel: vi.fn(async () => {
      if (blockResolver) {
        blockResolver({ value: undefined, done: true });
        blockResolver = null;
      }
    }),
    releaseLock: vi.fn(),
  };
  return {
    readable: {
      getReader: () => reader,
    },
    close: vi.fn(async () => {}),
    _reader: reader,
  };
}

/** Drain pending microtasks so the read loop advances past awaits. */
const flush = () => flushMicrotasks(5);

describe("streamSerialToDialog", () => {
  beforeEach(() => {
    // Pin wall-clock so the timestamp assertions are deterministic.
    // 22:40:23 matches the example in ansi-log.ts comments.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T22:40:23.500Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prepends a [HH:MM:SS] timestamp to each non-empty log line", async () => {
    const port = createMockPort([
      encode("[I][app:100]: Booting\n[W][gpio:5]: strapping\n"),
    ]);
    const dialog = mockDialog();
    const cancel = streamSerialToDialog(port, dialog);
    await flush();
    cancel();
    expect(dialog._lines).toEqual([
      expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\]\[I\]\[app:100\]: Booting$/),
      expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\]\[W\]\[gpio:5\]: strapping$/),
    ]);
  });

  it("strips trailing CR before prepending the timestamp", async () => {
    const port = createMockPort([encode("[I][app:100]: Hello\r\n")]);
    const dialog = mockDialog();
    const cancel = streamSerialToDialog(port, dialog);
    await flush();
    cancel();
    expect(dialog._lines).toHaveLength(1);
    expect(dialog._lines[0]).toMatch(/^\[\d{2}:\d{2}:\d{2}\]\[I\]\[app:100\]: Hello$/);
    expect(dialog._lines[0].endsWith("\r")).toBe(false);
  });

  it("stamps blank lines too — matching esphome/dashboard parity", async () => {
    /* esphome/dashboard's TimestampTransformer prefixes every chunk
       unconditionally, so we mirror that behaviour: a blank visual
       line still carries a [HH:MM:SS] anchor so the two web serial
       paths render identically when viewed side by side. */
    const port = createMockPort([encode("[I][a:1]: hi\n\n[I][a:2]: bye\n")]);
    const dialog = mockDialog();
    const cancel = streamSerialToDialog(port, dialog);
    await flush();
    cancel();
    expect(dialog._lines).toHaveLength(3);
    expect(dialog._lines[0]).toMatch(/^\[\d{2}:\d{2}:\d{2}\]\[I\]\[a:1\]: hi$/);
    expect(dialog._lines[1]).toMatch(/^\[\d{2}:\d{2}:\d{2}\]$/);
    expect(dialog._lines[2]).toMatch(/^\[\d{2}:\d{2}:\d{2}\]\[I\]\[a:2\]: bye$/);
  });

  it("drops a mis-sampled garbage line but keeps the clean lines around it", async () => {
    // Invalid UTF-8 bytes decode to U+FFFD replacement chars — the shape of an
    // ESP8266 boot banner read at the wrong baud. A clean line follows.
    const garbage = new Uint8Array([0x80, 0x81, 0xfe, 0xff, 0x80, 0x81, 0x0a]);
    const port = createMockPort([garbage, encode("[I][app:1]: ok\n")]);
    const dialog = mockDialog();
    const cancel = streamSerialToDialog(port, dialog);
    await flush();
    cancel();
    expect(dialog._lines).toHaveLength(1);
    expect(dialog._lines[0]).toMatch(/\[I\]\[app:1\]: ok$/);
  });

  it("buffers a partial line across chunks and stamps it once on completion", async () => {
    const port = createMockPort([encode("[I][app:100]: par"), encode("tial\n")]);
    const dialog = mockDialog();
    const cancel = streamSerialToDialog(port, dialog);
    await flush();
    cancel();
    expect(dialog._lines).toHaveLength(1);
    expect(dialog._lines[0]).toMatch(/^\[\d{2}:\d{2}:\d{2}\]\[I\]\[app:100\]: partial$/);
  });

  it("closes the port on cancel, after releasing the reader lock", async () => {
    // Regression: closing a still-locked port fails and leaves it open, so a
    // later open() throws "already open" and the logs dialog never reopens.
    // The lock must be released before close().
    const port = createMockPort([encode("[I][a:1]: hi\n")]);
    const dialog = mockDialog();
    const cancel = streamSerialToDialog(port, dialog);
    await flush();
    cancel();
    await flush();
    expect(port._reader.releaseLock).toHaveBeenCalled();
    expect(port.close).toHaveBeenCalledTimes(1);
    expect(port._reader.releaseLock.mock.invocationCallOrder[0]).toBeLessThan(
      port.close.mock.invocationCallOrder[0]
    );
  });
});
