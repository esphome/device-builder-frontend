import type { ESPHomeAPI } from "../api/index.js";
import type { DecodedBacktraceLine } from "../api/types/devices.js";
import {
  ADDRESS_RE,
  CRASH_END_RE,
  DECODED_RE,
  MAX_LINES_AFTER_MARKER,
  isCrashMarker,
} from "./crash-detector.js";
import { normalizeLogLine } from "./log-line.js";
import type { DecodedFrame } from "./stacktrace-decoder.js";
import { hostedDecoder } from "./stacktrace-decoder.js";

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

// The marker line plus everything the shared window allows after it.
const MAX_REGION_LINES = MAX_LINES_AFTER_MARKER + 1;

// Bold red, matching the colour esphome's logger gives an ERROR record. The
// raw UART panic handler emits no colour of its own, so a serial crash would
// otherwise scroll past in the same plain text as everything else.
const ANSI_CRASH = "\u001b[1;31m";
// Yellow, matching a WARNING record: over OTA the decoder's output comes from
// esphome's own logger at warning level, which is what gives it the
// `WARNING ` prefix and the colour. Ours arrives as bare text, so it wears
// both here and a serial session reads the same as an OTA one.
const ANSI_DECODED = "\u001b[0;33m";
const ANSI_RESET = "\u001b[0m";

// Decoding the same crash again costs a fresh ~70 MiB esphome import in the
// backend's child for an answer we already have, and a crash loop repeats one
// backtrace indefinitely. Keying on the region text means a loop pays once
// while every crash still renders decoded. Bounded, because a long session can
// see genuinely different crashes.
const MAX_CACHE_ENTRIES = 16;

// The artifact the hosted decoder needs, as `firmware/get_binaries` names it.
const ELF_FILE = "firmware.elf";

/**
 * ELF bytes per configuration, for the hosted-decoder path.
 *
 * Module-level and unbounded on purpose: an ELF is tens of megabytes and a
 * crash loop decodes region after region, so refetching per region is the cost
 * worth avoiding. The entry is the in-flight promise, so concurrent regions
 * share one download rather than racing. Bounded in practice by how many
 * distinct devices one tab streams logs from; the tab reload that ends the
 * session clears it, which is also what makes it safe to keep a build's bytes
 * after a reflash.
 */
const elfCache = new Map<string, Promise<ArrayBuffer | null>>();

/** Drop the session's ELF bytes. Tests only; production keeps them for the tab. */
export function resetElfCache(): void {
  elfCache.clear();
}

/**
 * Decode outcomes already seen this log session, keyed on the region text.
 *
 * A null value is a region the backend declined, cached so it isn't re-asked.
 */
export type CrashDecodeCache = Map<string, CrashDecode | null>;

// Reasons that describe the backend rather than the region (mirroring
// constants.DecodeUnavailable). They say nothing about whether this region is
// decodable, so a decode that returns none of them is remembered and one that
// returns them is asked again: a child killed under memory pressure must not
// leave the crash it was decoding undecodable for the rest of the session,
// which is the crash loop this feature exists for.
const BACKEND_FAULT_REASONS: ReadonlySet<string> = new Set([
  "decode_failed",
  "helper_failed",
]);

// Reasons worth a second opinion from the hosted decoder (mirroring
// constants.DecodeUnavailable).
//
// `no_build` is the one this exists for: a device built on a remote server has
// no CMake build tree here, and native ESP-IDF resolves addr2line only through
// that tree's cache, so the backend cannot decode a crash it has the ELF for.
// The fault reasons are worth retrying for the same reason they are not cached.
//
// Deliberately absent: `no_backtrace`, where there is nothing to decode and the
// hosted decoder would find nothing either, and `unsupported_platform`, where
// the target is not an ESP the decoder handles.
const HOSTED_FALLBACK_REASONS: ReadonlySet<string> = new Set([
  "no_build",
  "decode_failed",
  "helper_failed",
]);

// Shown where the reader is looking. The report gets the same verdict as a
// typed value, so this line is presentation, not transport.
/**
 * One wording for the stale-build caveat, in one place.
 *
 * The log line below, the downloadable report, and the prefilled issue all say
 * it, and a reader comparing them should not have to wonder whether a
 * difference in wording means a difference in fact.
 */
export const STALE_BUILD_NOTE =
  "Decoded against a local build that no longer matches the firmware running " +
  "on the device, so these frames may name the wrong lines.";

/** The caveat as it lands in the log, where every record carries a level. */
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

  /**
   * Offer the next line at absolute stream position *index*.
   *
   * Takes both forms because the caller has already normalized to classify
   * the line: *normalized* drives the grammar, *raw* is what gets kept, so
   * the region can be found in the buffer again.
   */
  push(raw: string, normalized: string, index: number): CrashRegion | null {
    const line = normalized;
    if (this._raw === null) {
      if (!isCrashMarker(line)) return null;
      this._raw = [raw];
      this._startIndex = index;
      return null;
    }
    this._raw.push(raw);
    if (CRASH_END_RE.test(line) || this._raw.length >= MAX_REGION_LINES)
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
 * True when *region* still needs decoding: it has an address, and nothing has
 * decoded it already.
 *
 * An OTA session's crash arrives with esphome's inline `Decoded` lines
 * present. Decoding again would spend a backend child to splice a second copy
 * of frames the log already shows.
 */
export function needsDecode(normalized: string[]): boolean {
  return (
    normalized.some((line) => ADDRESS_RE.test(line)) &&
    !normalized.some((line) => DECODED_RE.test(line))
  );
}

/**
 * Paint *raw* the colour esphome gives an ERROR record.
 *
 * The raw UART panic handler emits no colour, so a serial crash scrolls past
 * looking like ordinary output. An OTA crash already arrives red from the
 * device's logger, so lines that carry their own colour are left alone.
 */
export function colorizeCrash(raw: string[]): string[] {
  return raw.map((line) =>
    line.includes("\u001b[") || line.includes("\\033[") || line.trim() === ""
      ? line
      : `${ANSI_CRASH}${line}${ANSI_RESET}`
  );
}

/**
 * Rebuild *raw* with the decoder's output after the lines that produced it.
 *
 * Each entry's `index` is its offset into the region, which is what lets a
 * Web Serial session read like the OTA one rather than showing a decode
 * detached from its addresses.
 */
// Dress one decoder line as esphome logs would print it. A continuation
// (` (inlined by) ...`) belongs to the record above it, so it carries the
// colour but not a second level prefix.
function asWarning(text: string): string {
  const body = /^\s/.test(text) || text.startsWith("WARNING ") ? text : `WARNING ${text}`;
  return `${ANSI_DECODED}${body}${ANSI_RESET}`;
}

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
    byIndex.delete(i);
    if (stalePending) {
      // Say it where the reader is looking, above the frames it qualifies.
      out.push(asWarning(STALE_BUILD_LOG_LINE));
      stalePending = false;
    }
    out.push(...group.map(asWarning));
  });
  // An index past the region means the reply doesn't describe the lines that
  // were sent. Show the frames rather than dropping them, and say so.
  if (byIndex.size) {
    console.warn("Backtrace decode addressed lines outside the region", [
      ...byIndex.keys(),
    ]);
    if (stalePending) out.push(asWarning(STALE_BUILD_LOG_LINE));
    for (const group of byIndex.values()) out.push(...group.map(asWarning));
  }
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
  if (!needsDecode(lines)) return null;
  const key = `${configuration}\n${lines.join("\n")}`;
  // A declined decode is cached as null, not skipped: a platform the backend
  // can't decode still costs it a child to find that out, and a crash loop
  // repeats the same region indefinitely.
  if (cache.has(key)) return cache.get(key) ?? null;
  try {
    const result = await api.decodeBacktrace(configuration, lines);
    let decode: CrashDecode | null = result.decoded.length
      ? { decoded: result.decoded, staleBuild: result.stale_build }
      : null;
    // The backend first: it decodes against the exact toolchain the build used,
    // and costs no ELF transfer. Only when it says it cannot is the hosted
    // decoder worth the round trip.
    if (decode === null && HOSTED_FALLBACK_REASONS.has(result.unavailable_reason)) {
      decode = await decodeViaHostedDecoder(
        api,
        configuration,
        lines,
        result.stale_build
      );
    }
    if (decode !== null || !BACKEND_FAULT_REASONS.has(result.unavailable_reason)) {
      if (cache.size >= MAX_CACHE_ENTRIES) {
        // Map iterates in insertion order, so this drops the oldest.
        cache.delete(cache.keys().next().value!);
      }
      cache.set(key, decode);
    }
    return decode;
  } catch (err) {
    // Not cached: unlike a decline, a failure says nothing about the region,
    // and the next crash may well land while the backend is healthy again.
    console.warn("Backtrace decoding failed", err);
    return null;
  }
}

/**
 * Decode *lines* in the browser, against the ELF the backend already serves.
 *
 * The path a remote-built device takes: the build tree it was compiled in lives
 * on the build server, so nothing here can resolve addr2line, but the ELF
 * itself was materialised locally and is all a decoder needs.
 *
 * Every step is allowed to decline, and declining means the raw dump stands.
 * The gates run cheapest first so the common no-op costs the least: whether the
 * ELF exists at all is a local list, whether the decoder is reachable is one
 * page load, and only then is a multi-megabyte ELF worth fetching.
 *
 * *backendStaleBuild* rides through from the backend's reply, which knows both
 * the running firmware's config hash and the local build's whether or not it
 * could decode.
 */
async function decodeViaHostedDecoder(
  api: ESPHomeAPI,
  configuration: string,
  lines: string[],
  backendStaleBuild: boolean
): Promise<CrashDecode | null> {
  try {
    const binaries = await api.firmwareGetBinaries(configuration);
    // Absent for a device that was never built here, which is the other half of
    // what `no_build` means and the case that must not reach the network.
    if (!binaries.some((b) => b.file === ELF_FILE)) return null;
    if (!(await hostedDecoder().available())) return null;
    const elf = await loadElf(api, configuration);
    if (elf === null) return null;
    // Hand over a copy: postMessage transfers it (detaching what it is given),
    // and the cached original has to survive for the next region of a crash loop.
    const frames = await hostedDecoder().decode(elf.slice(0), lines.join("\n"));
    if (!frames?.length) return null;
    // Checked after mapping, not before: frames that resolve to no line leave
    // nothing to splice, and an empty decode would be cached and reported as a
    // success while rendering exactly like a failure.
    const decoded = framesToDecodedLines(frames, lines);
    if (!decoded.length) return null;
    return { decoded, staleBuild: backendStaleBuild };
  } catch (err) {
    console.warn("Hosted backtrace decoding failed", err);
    return null;
  }
}

/**
 * Attribute each frame to the log line whose text carries its address.
 *
 * The backend keys its output by line offset; the decoder keys by address,
 * having found them itself. Mapping back is what lets a decode land under the
 * line that produced it, which is the whole shape `interleaveDecoded` renders.
 * A frame whose address matches no line is dropped rather than guessed at.
 */
function framesToDecodedLines(
  frames: DecodedFrame[],
  lines: string[]
): DecodedBacktraceLine[] {
  const decoded: DecodedBacktraceLine[] = [];
  for (const frame of frames) {
    // Addresses print as 8 hex digits, with or without the 0x, in either case.
    const hex = frame.address.toString(16).padStart(8, "0");
    const index = lines.findIndex((line) => line.toLowerCase().includes(hex));
    if (index === -1) continue;
    const location = frame.location ? ` at ${frame.location}` : "";
    // The wording esphome's own decoders log, so a Web Serial decode reads like
    // the OTA one the device's logger would have printed.
    decoded.push({ index, text: `Decoded 0x${hex}: ${frame.function_name}${location}` });
  }
  return decoded;
}

/** The session's ELF bytes for *configuration*, fetched once. */
async function loadElf(
  api: ESPHomeAPI,
  configuration: string
): Promise<ArrayBuffer | null> {
  const cached = elfCache.get(configuration);
  if (cached !== undefined) return cached;
  // Awaited by every region of a crash loop, so the fetch is shared rather than
  // raced: an ELF runs to tens of megabytes.
  const pending = api
    .firmwareDownloadBytes(configuration, ELF_FILE)
    .catch((err): null => {
      console.warn("Could not download the ELF for decoding", err);
      return null;
    });
  elfCache.set(configuration, pending);
  return pending;
}
