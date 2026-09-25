import { ESPHomeLogParser, isLikelyGarbageLine } from "./esphome-log-parser.js";

/**
 * ``[HH:MM:SS]`` receive-time stamp for a serial log line. esphome/dashboard's
 * ``TimestampTransformer`` prefixes every WS chunk unconditionally; we match
 * that here so the Web Serial log path reads identically to the WS one.
 */
export function formatSerialTimestamp(now: Date): string {
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `[${hh}:${mm}:${ss}]`;
}

/**
 * Turns raw byte chunks into finished log lines with the formatting the
 * backend logs CLI applies: trailing CR stripped, baud-mismatch garbage
 * dropped, a receive-time stamp, and per-line ANSI colour/header
 * re-application via :class:`ESPHomeLogParser`. Every log transport feeds
 * it so all surfaces render identically.
 */
export function createLogLineAssembler(
  onLine: (line: string) => void
): (chunk: AllowSharedBufferSource) => void {
  const decoder = new TextDecoder();
  const parser = new ESPHomeLogParser();
  let buffer = "";
  return (chunk) => {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      /* Strip trailing CR (CRLF endings from the ROM bootloader and many
         serial sources). ``ansi-log`` treats any chunk ending in ``\r``
         as a progress-style overwrite, so CRLF boot lines would collapse
         to just the last one. */
      const cleaned = line.endsWith("\r") ? line.slice(0, -1) : line;
      // Drop mis-sampled UART garbage (e.g. an ESP8266's 74880-baud boot
      // banner read at the app's baud) before it reaches the parser.
      if (isLikelyGarbageLine(cleaned)) continue;
      onLine(`${formatSerialTimestamp(new Date())}${parser.parseLine(cleaned)}`);
    }
  };
}

export interface SerialLineHooks {
  /** One formatted log line (timestamp + parser color/prefix already applied). */
  onLine: (line: string) => void;
  /**
   * The device dropped the stream on its own (unplugged / reset / read error) —
   * i.e. the loop ended without the returned cancel being called. Not fired on a
   * caller-initiated cancel. ``error`` carries the read exception, if any.
   */
  onDisconnect?: (error?: unknown) => void;
}

/**
 * Read an **already-open** Web Serial port line by line, applying the same
 * formatting the backend logs CLI does: per-line ANSI color/header
 * re-application via :class:`ESPHomeLogParser`, a receive-time timestamp, and
 * baud-mismatch garbage filtering. Emits each finished line through
 * ``hooks.onLine``.
 *
 * Returns a cancel that stops the loop and closes the port (releasing the
 * reader lock first — closing a still-locked port fails and blocks the next
 * ``open()``). The caller owns ``port.open()``.
 *
 * Shared by the dashboard's post-install serial logs
 * (``streamSerialToDialog``) and ESPHome Web's logs dialog, so both web-serial
 * log surfaces stay byte-for-byte identical.
 */
export function streamSerialLines(
  port: SerialPort,
  hooks: SerialLineHooks
): () => Promise<void> {
  /* Read directly from ``port.readable.getReader()`` and decode in userland
     rather than going through ``port.readable.pipeTo()`` + a
     ``TextDecoderStream``. The pipeTo plumbing has been observed to silently
     swallow bytes on some bridge chips (notably CH9102F) after a close/reopen
     within the same USB session — direct reads do not. */
  const reader = port.readable!.getReader();
  const push = createLogLineAssembler(hooks.onLine);
  let cancelled = false;

  const readLoop = async (): Promise<void> => {
    // Set when the stream ends on its own (device drop / read error) rather than
    // via the caller's cancel — drives the optional onDisconnect notification.
    let disconnected = false;
    let disconnectError: unknown;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (cancelled) break;
        if (done) {
          disconnected = true;
          break;
        }
        if (value && value.length) push(value);
      }
    } catch (err) {
      // A read error while we weren't cancelling means the device dropped
      // mid-stream (unplugged, reset). A cancel-induced rejection is normal.
      if (!cancelled) {
        disconnected = true;
        disconnectError = err;
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* Lock already released — ignore. */
      }
    }
    if (disconnected) hooks.onDisconnect?.(disconnectError);
  };

  const loopDone = readLoop();

  let closed: Promise<void> | null = null;
  // Resolves once the port is closed, for callers that reopen it next.
  return () => {
    if (closed) return closed;
    cancelled = true;
    // Cancel the reader, then wait for the read loop to finish (its finally
    // block calls releaseLock) BEFORE closing the port. Closing a still-locked
    // port throws and leaves it open, blocking the next open(); awaiting
    // loopDone guarantees the lock is released first.
    closed = reader
      .cancel()
      .catch(() => {
        /* Already disposed — nothing to do. */
      })
      .then(() => loopDone)
      .then(() => port.close())
      .catch(() => {
        /* Port already closed (user pulled the cable, etc). */
      });
    return closed;
  };
}
