import type { ESPHomeAPI } from "../api/index.js";
import type {
  DecodeBacktraceResponse,
  DecodedBacktraceLine,
} from "../api/types/devices.js";
import {
  ADDRESS_RE,
  CRASH_END_RE,
  DECODED_RE,
  MAX_LINES_AFTER_MARKER,
  isCrashMarker,
} from "./crash-detector.js";
import { KeyedPromiseCache } from "./keyed-promise-cache.js";
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
 * ELF bytes for the hosted-decoder path, keyed on configuration + build.
 *
 * Holding them is the point: an ELF runs to tens of megabytes and a crash loop
 * decodes region after region. Holding *more than one* is not. Every entry but
 * the newest is provably dead, because the key names the build and a rebuild
 * only ever asks for the new one; keeping them would strand 5-18MB per rebuild
 * for the life of the tab, in exactly the edit-rebuild-crash session this
 * feature exists for. A rejected download evicts itself (the default), so one
 * blip doesn't leave the device undecodable either.
 */
const elfCache = new KeyedPromiseCache<ArrayBuffer>();
let elfCacheKey = "";

/** Drop the session's ELF bytes. Tests only; production keeps them for the tab. */
export function resetElfCache(): void {
  elfCache.clear();
  elfCacheKey = "";
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

// Reasons worth a second opinion from the hosted decoder.
//
// `elf_only` is the one this exists for: the backend has the ELF but
// not the build tree it was compiled in, so nothing there can resolve
// addr2line. The fault reasons join it, and unlike `elf_only` they are a
// transient fault rather than a verdict, so a region that hit one is cached
// null (the region text differs between crashes, so a loop still recovers on
// the next one, and the ELF download itself retries per KeyedPromiseCache).
// `no_build` is absent and must stay absent: it means the ELF isn't here
// either, so there is nothing to send.
const HOSTED_FALLBACK_REASONS: ReadonlySet<string> = new Set([
  ...BACKEND_FAULT_REASONS,
  "elf_only",
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
      decode = await decodeViaHostedDecoder(api, configuration, result, lines);
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
 * The path a remote-built device takes; see the decoder page's README for why
 * the ELF is the only local input left. Every step may decline, and declining
 * leaves the raw dump standing.
 *
 * The decoder is asked before the ELF is fetched, not alongside it: an
 * unreachable decoder costs a page load to discover, and finding out after a
 * multi-megabyte download would waste the download.
 */
async function decodeViaHostedDecoder(
  api: ESPHomeAPI,
  configuration: string,
  backend: DecodeBacktraceResponse,
  lines: string[]
): Promise<CrashDecode | null> {
  const decoder = hostedDecoder();
  try {
    if (!(await decoder.available())) return null;
    const elf = await loadElf(api, configuration, backend.local_config_hash);
    const frames = await decoder.decode(elf, lines.join("\n"));
    if (!frames?.length) return null;
    // Checked after mapping, not before: frames that resolve to no line leave
    // nothing to splice, and an empty decode would be cached and reported as a
    // success while rendering exactly like a failure.
    const decoded = framesToDecodedLines(frames, lines);
    if (!decoded.length) return null;
    return { decoded, staleBuild: backend.stale_build };
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
  // The address values in each line, once. Compared by value, not substring:
  // 4201b6e0 must not attach to a line where it only appears inside a longer
  // hex run like 0x4201b6e0abcd. The `\w` boundaries pin it to a whole 8-digit
  // token (optionally 0x-prefixed), rejecting both a hex neighbour and any word
  // char after it, the same terminator ADDRESS_RE's `\b` gives (so `0x1234abcdx`
  // is not a token here either).
  const addressesPerLine = lines.map((line) => {
    const found = new Set<number>();
    for (const m of line.matchAll(/(?<!\w)(?:0x)?([0-9a-f]{8})(?!\w)/gi)) {
      found.add(parseInt(m[1], 16));
    }
    return found;
  });
  const decoded: DecodedBacktraceLine[] = [];
  for (const frame of frames) {
    const index = addressesPerLine.findIndex((addrs) => addrs.has(frame.address));
    if (index === -1) continue;
    const hex = frame.address.toString(16).padStart(8, "0");
    const location = frame.location ? ` at ${frame.location}` : "";
    // The wording esphome's own decoders log, so a Web Serial decode reads like
    // the OTA one the device's logger would have printed.
    decoded.push({ index, text: `Decoded 0x${hex}: ${frame.function_name}${location}` });
  }
  return decoded;
}

/**
 * The session's ELF bytes for *configuration* at *configHash*, fetched once.
 *
 * Keyed on the config hash, not just the device: a rebuild mid-session replaces
 * the ELF on disk, and serving the old bytes would decode the next crash
 * against the wrong build and report it without a caveat (`stale_build` goes
 * false the moment the device is reflashed to match). A new hash simply misses.
 *
 * The bound is the config hash, not the binary: a recompile that changes the
 * binary without changing the YAML (a toolchain or library bump) keeps the same
 * key. That is the same precision the backend's `stale_build` has, and the
 * accepted ceiling here.
 *
 * Throws as the download does, which the caller turns into "no decode".
 */
function loadElf(
  api: ESPHomeAPI,
  configuration: string,
  configHash: string
): Promise<ArrayBuffer> {
  // No hash means the build can't be told apart from the next one (an ELF
  // present without a build_info.json). Caching under a hash-less key would
  // serve one build's bytes for another after a rebuild, so fetch uncached.
  if (!configHash) return api.firmwareDownloadBytes(configuration, ELF_FILE);
  const key = `${configuration}\n${configHash}`;
  if (key !== elfCacheKey) {
    elfCache.clear();
    elfCacheKey = key;
  }
  return elfCache.fetch(key, () => api.firmwareDownloadBytes(configuration, ELF_FILE));
}
