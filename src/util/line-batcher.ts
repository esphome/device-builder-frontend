/**
 * rAF-batched sink for streamed log lines.
 *
 * Reactive log arrays must be reassigned (not mutated) for Lit change
 * detection, so appending per line copies the whole array per line —
 * O(n²) over a compile log. Buffer here and coalesce into one
 * reassignment per animation frame instead (#348, #1203). Call
 * ``flush()`` at terminal transitions so consumers don't race the rAF,
 * and ``reset()`` alongside every log-array reset.
 *
 * ``maxLines`` bounds only the PENDING buffer — rAF doesn't fire while
 * the tab is hidden, so a flood can pile up unflushed. Capping the
 * merged visible buffer is the append callback's job (it owns that
 * array; see ``LogBuffer``).
 */
export class LineBatcher {
  private _pending: string[] = [];
  private _scheduled = 0;
  private readonly _maxLines?: number;

  constructor(
    private readonly _append: (batch: string[]) => void,
    opts: { maxLines?: number } = {}
  ) {
    this._maxLines = opts.maxLines;
  }

  enqueue(line: string): void {
    this._pending.push(line);
    // Trim with headroom — for a positive maxLines that's one slice per
    // maxLines pushes rather than every push; at 0 every push slices, to empty.
    // Counted from the front rather than as slice(-maxLines): a maxLines of 0
    // makes -maxLines a negative zero, which keeps the whole array, so nothing
    // would ever be dropped and a hidden tab would buffer without bound.
    if (this._maxLines !== undefined && this._pending.length > 2 * this._maxLines) {
      this._pending = this._pending.slice(this._pending.length - this._maxLines);
    }
    if (this._scheduled) return;
    this._scheduled = requestAnimationFrame(() => {
      this._scheduled = 0;
      this.flush();
    });
  }

  flush(): void {
    if (this._pending.length === 0) return;
    const batch = this._pending;
    this._pending = [];
    this._append(batch);
  }

  reset(): void {
    this._pending = [];
    if (this._scheduled) {
      cancelAnimationFrame(this._scheduled);
      this._scheduled = 0;
    }
  }
}
