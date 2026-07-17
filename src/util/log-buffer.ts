import type { ReactiveControllerHost } from "lit";
import { LineBatcher } from "./line-batcher.js";

export interface LogBufferOptions {
  /** Retain only the newest *maxLines*. Unbounded when omitted. */
  maxLines?: number;
  /** Called after each append with the batch and the stream position of its first line. */
  onAppend?: (lines: readonly string[], start: number) => void;
}

/**
 * A streamed log's line array, its cap, and the map from a line's absolute
 * stream position onto the index it currently sits at.
 *
 * Those three belong together: the cap drops lines off the front, which moves
 * every line after it, so an owner that caps without owning the shift forces
 * its consumers to be told about the trim and to apply it in the right order.
 *
 * Takes the host only to request an update — it deliberately doesn't
 * ``addController``, because its lifetime is the buffer's, not the DOM's: a
 * reset must be driven by whoever replaces the lines, never by a disconnect.
 */
export class LogBuffer {
  private _lines: string[] = [];
  private _batcher: LineBatcher;
  // bufferIndex = streamPosition + _shift.
  private _shift = 0;
  private _streamCount = 0;
  private _epoch = 0;
  private readonly _maxLines?: number;
  private readonly _onAppend?: (lines: readonly string[], start: number) => void;

  constructor(
    private readonly _host: ReactiveControllerHost,
    opts: LogBufferOptions = {}
  ) {
    this._maxLines = opts.maxLines;
    this._onAppend = opts.onAppend;
    this._batcher = new LineBatcher((batch) => this.append(batch), {
      maxLines: opts.maxLines,
    });
  }

  /** A fresh array per mutation, so a Lit ``.lines=`` binding sees the change.
   *  Readonly: the shift and the cap are only right if every write comes
   *  through this class. */
  get lines(): readonly string[] {
    return this._lines;
  }

  /** Bumped by every reset, so work started against a replaced buffer can drop itself. */
  get epoch(): number {
    return this._epoch;
  }

  /** Buffer a line for the next animation frame. */
  enqueue(line: string): void {
    this._batcher.enqueue(line);
  }

  /** Append *lines* now; returns the stream position of ``lines[0]``. */
  append(lines: readonly string[]): number {
    const start = this._streamCount;
    this._streamCount += lines.length;
    this._setLines([...this._lines, ...lines]);
    this._onAppend?.(lines, start);
    return start;
  }

  /** Drain buffered lines now, so consumers don't race the frame. */
  flush(): void {
    this._batcher.flush();
  }

  /** Drop what's buffered for the next frame, keeping the lines already shown. */
  dropPending(): void {
    this._batcher.reset();
  }

  /** Drop everything, including anything buffered for the next frame. */
  reset(): void {
    this._batcher.reset();
    this._lines = [];
    this._shift = 0;
    this._streamCount = 0;
    this._epoch += 1;
    this._host.requestUpdate();
  }

  /**
   * Where the run of lines at *streamPosition* currently sits; null when it
   * isn't there.
   *
   * Verifies every line against *expected* rather than just the ends: a
   * repeating stream (a crash loop dumping the same panic) produces runs that
   * share a first and last line, so an ends-only check would accept a
   * mispositioned write in exactly the case that produces two runs to confuse.
   */
  indexOf(streamPosition: number, expected: readonly string[]): number | null {
    const at = streamPosition + this._shift;
    // Out of bounds is ordinary: the cap drops from the front, so a run either
    // survives whole or loses its head to a flood.
    if (at < 0 || at + expected.length > this._lines.length) return null;
    if (expected.some((line, i) => this._lines[at + i] !== line)) {
      // In bounds but not there. The cap moves every line by the same amount,
      // so the only way here is a shift that has drifted from the buffer, which
      // would otherwise read as the caller quietly ceasing to work.
      console.warn("Log run is not at its tracked position; refusing to resolve it", at);
      return null;
    }
    return at;
  }

  /**
   * Swap the run at *streamPosition* for *replacement*.
   *
   * Only the newest tracked run may be replaced. The position map is a single
   * shift, and a length-changing rewrite adds the delta to all of it, which is
   * only true of the positions after *streamPosition*: everything up to and
   * including it stops resolving from then on.
   *
   * False when the run has churned out from under the caller and was left alone
   * rather than written in the wrong place.
   */
  replace(
    streamPosition: number,
    expected: readonly string[],
    replacement: readonly string[]
  ): boolean {
    const at = this.indexOf(streamPosition, expected);
    if (at === null) return false;
    const next = [...this._lines];
    next.splice(at, expected.length, ...replacement);
    this._shift += replacement.length - expected.length;
    this._setLines(next);
    return true;
  }

  private _setLines(next: string[]): void {
    const max = this._maxLines;
    if (max === undefined || next.length <= max) {
      this._lines = next;
      this._host.requestUpdate();
      return;
    }
    // Counted from the front rather than as slice(-max): a maxLines of 0 makes
    // -max a negative zero, which slices the whole array while the shift below
    // says every line went.
    this._shift -= next.length - max;
    this._lines = next.slice(next.length - max);
    this._host.requestUpdate();
  }
}
