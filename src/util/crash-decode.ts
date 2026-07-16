import type { ESPHomeAPI } from "../api/index.js";
import type { DecodedBacktraceLine } from "../api/types/devices.js";
import { isCrashMarker } from "./crash-detector.js";
import { STALE_BUILD_NOTE } from "./crash-report.js";
import { normalizeLogLine } from "./log-line.js";

/**
 * Backend-decoded backtraces for crashes captured over Web Serial.
 *
 * `esphome logs` decodes inline as lines arrive, so a backend-streamed session
 * already carries its `Decoded 0x...` lines. A browser reading the UART has no
 * decoder, which is exactly the session that catches a crash loop (a crash
 * kills an OTA log stream), so those sessions would otherwise show raw
 * addresses. This drives the same decode from the log viewer and splices the
 * output back into the buffer, so the viewer matches the OTA path and the
 * crash report picks the frames up through the scraper it already has.
 */

// Terminators of a crash dump: the region is complete and can be sent.
const REGION_END_RE = /<<<stack<<<|^ELF file SHA256:|^Rebooting\.\.\./;

// Cap on a region with no terminator, mirroring the report scraper's window
// so the backend sees the same shape from either path.
const MAX_REGION_LINES = 61;

// Any 8-hex-digit address, optionally 0x-prefixed. Without one there is
// nothing to resolve, so the region isn't worth a request.
const ADDRESS_RE = /(?:0x)?[0-9a-fA-F]{8}(?::|\b)/;

// Decoding the same crash again costs a fresh ~70 MiB esphome import in the
// backend's child for an answer we already have, and a crash loop repeats one
// backtrace indefinitely. Keying on the region text means a loop pays once
// while every crash still renders decoded. Bounded, because a long session can
// see genuinely different crashes.
const MAX_CACHE_ENTRIES = 16;

/** Decodes already seen this log session, keyed on the region text. */
export type CrashDecodeCache = Map<string, CrashDecode>;

// Mirrors what esphome logs would print: the decoder's caveat arrives as a
// log line, so it reaches the reader and the crash report the same way the
// frames do.
export const STALE_BUILD_LOG_LINE = `WARNING ${STALE_BUILD_NOTE}`;

export interface CrashDecode {
  /** Decoder output, each tagged with its line's offset into the region. */
  decoded: DecodedBacktraceLine[];
  /** The local build no longer matches the running firmware, so the frames
   *  are confident but wrong. */
  staleBuild: boolean;
}

/** A complete crash region lifted out of the stream. */
export interface CrashRegion {
  /** Lines exactly as they sit in the log buffer, so they can be found again. */
  raw: string[];
  /** Absolute stream position of `raw[0]`, counting dropped lines. */
  startIndex: number;
}

/**
 * Accumulates one crash region from a log stream.
 *
 * Fed line by line as they arrive; returns the region once its terminator
 * lands, and null until then. Buffering the region here rather than indexing
 * into the log buffer keeps it immune to the buffer's cap dropping lines out
 * from under it mid-crash.
 */
export class CrashRegionCollector {
  private _raw: string[] | null = null;
  private _startIndex = -1;

  /** Offer the next raw line at absolute stream position *index*. */
  push(raw: string, index: number): CrashRegion | null {
    const line = normalizeLogLine(raw);
    if (this._raw === null) {
      if (!isCrashMarker(line)) return null;
      this._raw = [raw];
      this._startIndex = index;
      return null;
    }
    this._raw.push(raw);
    if (REGION_END_RE.test(line) || this._raw.length >= MAX_REGION_LINES)
      return this.take();
    return null;
  }

  /** Hand over whatever has accumulated and reset; null when empty. */
  take(): CrashRegion | null {
    if (this._raw === null) return null;
    const region = { raw: this._raw, startIndex: this._startIndex };
    this._raw = null;
    this._startIndex = -1;
    return region;
  }
}

/**
 * Rebuild *raw* with the decoder's output after the lines that produced it.
 *
 * Each entry's `index` is its offset into the region, which is what lets a
 * Web Serial session read like the OTA one rather than showing a decode
 * detached from its addresses.
 */
export function interleaveDecoded(raw: string[], decode: CrashDecode): string[] {
  const byIndex = new Map<number, string[]>();
  for (const { index, text } of decode.decoded) {
    const group = byIndex.get(index);
    if (group) group.push(text);
    else byIndex.set(index, [text]);
  }
  const out: string[] = [];
  let stalePending = decode.staleBuild;
  raw.forEach((line, i) => {
    out.push(line);
    const group = byIndex.get(i);
    if (!group) return;
    if (stalePending) {
      // Say it where the reader is looking, above the frames it qualifies.
      out.push(STALE_BUILD_LOG_LINE);
      stalePending = false;
    }
    out.push(...group);
  });
  return out;
}

/**
 * Decode *raw*; null when there is nothing to decode or the backend declined.
 *
 * *cache* is the caller's, and is expected to live no longer than the log
 * session: a reflash between sessions can leave the same addresses meaning
 * different lines, so a decode must not outlive the buffer it came from.
 *
 * Failures resolve to null rather than throwing: a decode is an embellishment
 * on the log, and the raw dump stays readable without it.
 */
export async function decodeCrashRegion(
  api: ESPHomeAPI,
  configuration: string,
  raw: string[],
  cache: CrashDecodeCache
): Promise<CrashDecode | null> {
  // The backend's contract is normalized lines (no ANSI, no timestamp), and
  // normalization is one-for-one, so a decoded entry's index addresses the
  // raw line at the same offset.
  const lines = raw.map(normalizeLogLine);
  if (!lines.some((line) => ADDRESS_RE.test(line))) return null;
  const key = `${configuration}\n${lines.join("\n")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const result = await api.decodeBacktrace(configuration, lines);
    if (result.decoded.length === 0) return null;
    const decode: CrashDecode = {
      decoded: result.decoded,
      staleBuild: result.stale_build,
    };
    if (cache.size >= MAX_CACHE_ENTRIES) {
      // Map iterates in insertion order, so this drops the oldest.
      cache.delete(cache.keys().next().value!);
    }
    cache.set(key, decode);
    return decode;
  } catch (err) {
    console.warn("Backtrace decoding failed", err);
    return null;
  }
}
