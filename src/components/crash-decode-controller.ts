import type { ESPHomeAPI } from "../api/index.js";
import {
  type CrashDecode,
  type CrashDecodeCache,
  type CrashRegion,
  CrashRegionCollector,
  colorizeCrash,
  decodeCrashRegion,
  interleaveDecoded,
} from "../util/crash-decode.js";

/**
 * Inline crash decoding for a streamed log buffer.
 *
 * Owns the map from a line's absolute stream position onto the buffer it
 * currently sits at, which is the whole difficulty: the cap drops lines off
 * the front and decoding splices lines in, and both move everything after
 * them. Deliberately not a Lit ``ReactiveController`` — every counter here is
 * meaningful only against one buffer, so this resets with the buffer, never
 * with the host's DOM lifetime.
 */

/** The buffer this decorates, read lazily so the host can construct first. */
export interface CrashDecodeHost {
  api(): ESPHomeAPI;
  configuration(): string;
  getLines(): string[];
  /** Replace the buffer, applying the host's cap. */
  setLines(next: string[]): void;
}

export class CrashDecodeController {
  private _region = new CrashRegionCollector();
  // Scoped to the session: a reflash can leave the same addresses meaning
  // different lines, so a decode must not outlive its buffer.
  private _cache: CrashDecodeCache = new Map();
  private _streamIndex = 0;
  private _indexShift = 0;
  // Bumped whenever the buffer is reset; a decode in flight against the old
  // buffer must not splice into the new one.
  private _epoch = 0;
  // Serialises decodes so each splice lands before the next is positioned.
  private _chain: Promise<void> = Promise.resolve();
  private _staleBuild = false;

  constructor(private readonly host: CrashDecodeHost) {}

  /** Whether any decode this session came back against a mismatched build. */
  get staleBuild(): boolean {
    return this._staleBuild;
  }

  /**
   * Feed one streamed line, already in the buffer.
   *
   * Takes the normalized form rather than deriving it: the host needs it too,
   * and this runs for every line of a stream that can push thousands a second.
   */
  observe(raw: string, normalized: string): void {
    const region = this._region.push(raw, normalized, this._streamIndex);
    this._streamIndex += 1;
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

  /** The cap dropped *count* lines off the front of the buffer. */
  noteTrimmed(count: number): void {
    this._indexShift -= count;
  }

  /** Drop everything; the caller is replacing the buffer it all refers to. */
  reset(): void {
    this._epoch += 1;
    this._streamIndex = 0;
    this._indexShift = 0;
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
    const raw = colorizeCrash(region.raw);
    if (raw.every((line, i) => line === region.raw[i])) {
      // An OTA crash arrives red from the device's logger, so there is nothing
      // to replace. It still has to be present to be worth decoding.
      return this._positionOf(region) === null ? null : region;
    }
    return this._replaceRegion(region, raw)
      ? { raw, startIndex: region.startIndex }
      : null;
  }

  // Decode regions one at a time, so each splice lands before the next
  // region's position is computed. Fire-and-forget: the log keeps streaming
  // while the backend's child works, and a failure leaves the dump untouched.
  private _queueDecode(region: CrashRegion): void {
    const epoch = this._epoch;
    this._chain = this._chain
      .then(async () => {
        if (epoch !== this._epoch) return;
        const decode = await decodeCrashRegion(
          this.host.api(),
          this.host.configuration(),
          region.raw,
          this._cache
        );
        if (decode === null || epoch !== this._epoch) return;
        if (decode.staleBuild) this._staleBuild = true;
        this._splice(region, decode);
      })
      .catch((err) => console.warn("Inline backtrace decode failed", err));
  }

  private _splice(region: CrashRegion, decode: CrashDecode): void {
    this._replaceRegion(region, interleaveDecoded(region.raw, decode));
  }

  // Where *region* currently sits in the buffer; null when it isn't there.
  //
  // Verifies every line, not just the ends. A crash loop repeats one dump
  // verbatim, so its regions share a first and last line; ends-only would
  // accept a mispositioned splice in exactly the case that produces two
  // regions to confuse.
  private _positionOf(region: CrashRegion): number | null {
    const { raw, startIndex } = region;
    const lines = this.host.getLines();
    const at = startIndex + this._indexShift;
    // Out of bounds is ordinary: the cap drops from the front, so a region
    // either survives whole or loses its head, and a flood can take one
    // between its marker and its terminator.
    if (at < 0 || at + raw.length > lines.length) return null;
    if (raw.some((line, i) => lines[at + i] !== line)) {
      // In bounds but not there. The cap moves every line by the same amount,
      // so the only way here is a shift that has drifted from the buffer —
      // which would otherwise read as decoding quietly ceasing to work.
      console.warn("Crash region is not at its tracked position; not decorating it", at);
      return null;
    }
    return at;
  }

  // Swap a region for *replacement*; false when it has churned out from under
  // us and was left alone rather than decorated in the wrong place.
  private _replaceRegion(region: CrashRegion, replacement: string[]): boolean {
    const at = this._positionOf(region);
    if (at === null) return false;
    const next = [...this.host.getLines()];
    next.splice(at, region.raw.length, ...replacement);
    this._indexShift += replacement.length - region.raw.length;
    this.host.setLines(next);
    return true;
  }
}
