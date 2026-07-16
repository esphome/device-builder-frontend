import type { ESPHomeAPI } from "../api/index.js";
import { CRASH_RELATED_RE, extractDecodedFrames } from "./crash-report.js";
import type { CrashScrape } from "./crash-report.js";

/**
 * Backend-decoded backtraces, for crashes captured over Web Serial.
 *
 * `esphome logs` decodes inline, so a backend-streamed session arrives with
 * its `Decoded 0x...` lines already in the buffer and nothing here runs. A
 * browser reading the UART has no decoder, which is exactly the session that
 * catches a crash loop (a crash kills an OTA log stream), so those reports
 * would otherwise ship raw addresses.
 */

export interface CrashDecode {
  /** Decoded frames, in the shape `scrape.decodedFrames` already carries. */
  frames: string[];
  /** The local build no longer matches the running firmware, so the frames
   *  are confident but wrong. */
  staleBuild: boolean;
  /** Backend's reason for decoding nothing; "" when it decoded. */
  unavailableReason: string;
}

/**
 * True when the backend is worth asking.
 *
 * Requires a crash with addresses and no inline decode: a session that
 * already decoded needs nothing, and an excerpt with no address gives the
 * decoder nothing to work with.
 */
export function needsBackendDecode(scrape: CrashScrape): boolean {
  return (
    scrape.crashFound &&
    scrape.decodedFrames.length === 0 &&
    scrape.excerpt.some((line) => CRASH_RELATED_RE.test(line))
  );
}

/**
 * Ask the backend to decode `scrape`'s excerpt; null when it declined or
 * produced nothing usable.
 *
 * The excerpt is already normalized (ANSI and timestamp stripped), which is
 * what lets one command serve both transports. Failures resolve to null
 * rather than throwing: a decode embellishes a crash report, and the report
 * is still worth filing without one.
 */
export async function decodeCrashBacktrace(
  api: ESPHomeAPI,
  configuration: string,
  scrape: CrashScrape
): Promise<CrashDecode | null> {
  if (!needsBackendDecode(scrape)) return null;
  try {
    const result = await api.decodeBacktrace(configuration, scrape.excerpt);
    // The backend returns what `esphome logs` would have printed, so the
    // same scraper that reads the inline path reads this one.
    const frames = extractDecodedFrames(result.decoded.map((line) => line.text));
    if (frames.length === 0) return null;
    return {
      frames,
      staleBuild: result.stale_build,
      unavailableReason: result.unavailable_reason,
    };
  } catch (err) {
    console.warn("Backtrace decoding failed", err);
    return null;
  }
}
