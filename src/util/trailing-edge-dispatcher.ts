/**
 * Concurrency-of-1 dispatcher with trailing-edge replay.
 *
 * The frontend version of an ``async with self._lock`` block in
 * Python: callers ``dispatch(input)`` and the underlying runner
 * is guaranteed to run at most one instance at a time. Calls
 * that arrive while a runner is in flight don't queue — they
 * overwrite a single ``_pending`` slot, and only the latest one
 * fires when the in-flight call resolves. So a typing storm
 * collapses to "first input + last input" rather than "every
 * input ever typed", which is exactly what a debounced search
 * box wants.
 *
 * Why not a real mutex (queueing every caller): the use case
 * here is "user typed three things mid-flight, only the third
 * matters". A mutex would fire all three in order — wasteful
 * I/O on the backend and stale results on the frontend.
 *
 * Lifecycle is RAII-shaped: ``dispatch`` is fire-and-forget,
 * the running state is automatically released in a ``try /
 * finally`` so an exception in the runner can't leave the
 * dispatcher stuck.
 */

export class TrailingEdgeDispatcher<T> {
  private _running = false;
  private _pending: T | null = null;
  private _hasPending = false;

  constructor(private readonly _runner: (input: T) => Promise<void>) {}

  /**
   * Request a run for *input*.
   *
   * If no run is in flight, fires immediately. Otherwise stashes
   * *input* in the single pending slot — overwriting any earlier
   * pending value — to be picked up when the in-flight run
   * resolves.
   */
  dispatch(input: T): void {
    if (this._running) {
      this._pending = input;
      this._hasPending = true;
      return;
    }
    void this._run(input);
  }

  /**
   * Drop any pending input without firing.
   *
   * Called when the host wants to abandon a queued search —
   * e.g. the user closed the dropdown or switched out of search
   * mode entirely. Doesn't cancel an already-running call (the
   * caller is responsible for ignoring its result via a sequence
   * number or similar guard); just ensures the trailing-edge
   * replay won't fire after the host has moved on.
   */
  cancelPending(): void {
    this._pending = null;
    this._hasPending = false;
  }

  get isRunning(): boolean {
    return this._running;
  }

  private async _run(input: T): Promise<void> {
    this._running = true;
    try {
      // Runners are expected to handle their own errors (a
      // palette search hides WS hiccups behind an empty result
      // list, etc.), but a throw still reaches us. Log at debug
      // so a developer chasing "popup never opens" has a
      // breadcrumb, then swallow — the ``void this._run(...)``
      // fire-and-forget call site would otherwise surface the
      // throw as an unhandled rejection.
      //
      // ``try/catch`` around the call (not ``.catch`` on its
      // returned promise) so a *synchronous* throw inside the
      // runner — a TypeError before the function ever gets to
      // ``return``ing a promise — is also caught. ``.catch``
      // alone would miss those: the expression
      // ``this._runner(input)`` would throw before ``.catch`` is
      // ever reached, propagating up as an unhandled rejection
      // of this async function.
      try {
        await this._runner(input);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.debug("TrailingEdgeDispatcher: runner threw", err);
      }
    } finally {
      this._running = false;
      if (this._hasPending) {
        const next = this._pending as T;
        this._pending = null;
        this._hasPending = false;
        void this._run(next);
      }
    }
  }
}
