import type { ESPHomeAPI } from "../api/index.js";
import {
  type CrashDecodeCache,
  type CrashRegion,
  CrashRegionCollector,
  colorizeCrash,
  decodeCrashRegion,
  interleaveDecoded,
} from "../util/crash-decode.js";
import type { LogBuffer } from "../util/log-buffer.js";

/** Read lazily so the host can construct this alongside its buffer. */
export interface CrashDecodeHost {
  api(): ESPHomeAPI;
  configuration(): string;
  buffer(): LogBuffer;
}

/**
 * Inline crash decoding for a streamed log buffer.
 *
 * A consumer of the buffer, not a co-owner: positioning a region against a
 * buffer the cap keeps trimming is the buffer's job, so this only has to
 * recognise a crash, colour it, and rewrite it once the backend answers.
 */
export class CrashDecodeController {
  private _region = new CrashRegionCollector();
  // Scoped to the session: a reflash can leave the same addresses meaning
  // different lines, so a decode must not outlive its buffer.
  private _cache: CrashDecodeCache = new Map();
  // Serialises decodes so each splice lands before the next is positioned.
  private _chain: Promise<void> = Promise.resolve();
  private _staleBuild = false;

  constructor(private readonly host: CrashDecodeHost) {}

  /** Whether any decode this session came back against a mismatched build. */
  get staleBuild(): boolean {
    return this._staleBuild;
  }

  /**
   * Feed one streamed line, already appended to the buffer at *streamIndex*.
   *
   * Takes the normalized form rather than deriving it: the host needs it too,
   * and this runs for every line of a stream that can push thousands a second.
   */
  observe(raw: string, normalized: string, streamIndex: number): void {
    const region = this._region.push(raw, normalized, streamIndex);
    if (!region) return;
    // Paint before decoding: colouring is 1:1, so it never moves the shift,
    // and the region comes back as it now sits in the buffer so a decode
    // splice landing later still recognises it.
    const painted = this._paint(region);
    // Gone already: a batch big enough to trim the region's head can land
    // between its marker and its terminator. Nothing to decorate, so decoding
    // would spend a backend child on a splice that cannot land.
    if (painted === null) return;
    this._queueDecode(painted);
  }

  /** Drop everything; the caller is resetting the buffer it all refers to. */
  reset(): void {
    this._staleBuild = false;
    this._region = new CrashRegionCollector();
    // Replaced, not cleared: a decode still in flight kept a reference to the
    // old map and writes its result on return, which would seed the new
    // session with frames decoded against the buffer it just replaced.
    this._cache = new Map();
    // Detached for the same reason. The old chain still settles, and its epoch
    // check drops the splice, but the new session must not queue behind a
    // decode it is going to discard: that is a whole backend timeout of the
    // next crash going undecorated.
    this._chain = Promise.resolve();
  }

  // The raw UART panic handler emits no colour of its own, so a serial crash
  // would scroll past looking like ordinary output. Null when the region is no
  // longer in the buffer to colour.
  private _paint(region: CrashRegion): CrashRegion | null {
    const buffer = this.host.buffer();
    const raw = colorizeCrash(region.raw);
    if (raw.every((line, i) => line === region.raw[i])) {
      // An OTA crash arrives red from the device's logger, so there is nothing
      // to replace. It still has to be present to be worth decoding.
      return buffer.indexOf(region.startIndex, region.raw) === null ? null : region;
    }
    return buffer.replace(region.startIndex, region.raw, raw)
      ? { raw, startIndex: region.startIndex }
      : null;
  }

  // Decode regions one at a time, so each splice lands before the next
  // region's position is computed. Fire-and-forget: the log keeps streaming
  // while the backend's child works, and a failure leaves the dump untouched.
  private _queueDecode(region: CrashRegion): void {
    const buffer = this.host.buffer();
    const epoch = buffer.epoch;
    this._chain = this._chain
      .then(async () => {
        if (epoch !== buffer.epoch) return;
        const decode = await decodeCrashRegion(
          this.host.api(),
          this.host.configuration(),
          region.raw,
          this._cache
        );
        if (decode === null || epoch !== buffer.epoch) return;
        if (decode.staleBuild) this._staleBuild = true;
        buffer.replace(
          region.startIndex,
          region.raw,
          interleaveDecoded(region.raw, decode)
        );
      })
      .catch((err) => console.warn("Inline backtrace decode failed", err));
  }
}
