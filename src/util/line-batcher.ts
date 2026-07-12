/**
 * rAF-batched sink for streamed log lines.
 *
 * Reactive log arrays must be reassigned (not mutated) for Lit change
 * detection, so appending per line copies the whole array per line —
 * O(n²) over a compile log. Buffer here and coalesce into one
 * reassignment per animation frame instead (#348, #1203). Call
 * ``flush()`` at terminal transitions so consumers don't race the rAF,
 * and ``reset()`` alongside every log-array reset.
 */
export class LineBatcher {
  private _pending: string[] = [];
  private _scheduled = 0;

  constructor(private readonly _append: (batch: string[]) => void) {}

  enqueue(line: string): void {
    this._pending.push(line);
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
