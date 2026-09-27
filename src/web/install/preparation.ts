import type { ReactiveControllerHost } from "lit";

/** What a preparation came to: its value, or why there is none. */
export type Prepared<T, F> = { value: T } | { failure: F; retryable: boolean };

export type PreparationState<I, T> =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "ready"; value: T }
  /** A chunk the check needs did not load; the input is kept to try again. */
  | { kind: "retryable"; input: I };

/**
 * Gets something ready to install before the user clicks, where reading,
 * fetching a chunk or parsing is needed first. A device picker needs the
 * click's user activation, which does not outlast that work on a slow
 * network, so a flow offers its install only in the ``ready`` state and the
 * click goes straight to the picker. An input that cannot be installed is
 * also named before a port is asked for.
 *
 * A failure that is the input's own (not firmware) drops it; one that is
 * not (a chunk that did not load) keeps it for ``retry``.
 */
export class Preparation<I, T, F> {
  state: PreparationState<I, T> = { kind: "idle" };

  // Supersedes a preparation that a newer input, or a clear, overtook.
  private _generation = 0;

  constructor(
    private readonly _host: ReactiveControllerHost,
    /** Must not reject: a failure is a result. */
    private readonly _prepare: (input: I) => Promise<Prepared<T, F>>,
    /** A preparation ended: with why it failed, or null when ready. */
    private readonly _onSettled: (failure: F | null) => void
  ) {}

  start(input: I): void {
    const generation = ++this._generation;
    this._set({ kind: "pending" });
    void this._prepare(input).then((result) => {
      if (generation !== this._generation) return;
      if ("value" in result) {
        this._set({ kind: "ready", value: result.value });
        this._onSettled(null);
        return;
      }
      this._set(result.retryable ? { kind: "retryable", input } : { kind: "idle" });
      this._onSettled(result.failure);
    });
  }

  /** Prepare the input a chunk failed to load for again. */
  retry(): void {
    if (this.state.kind === "retryable") this.start(this.state.input);
  }

  /** Drop what was prepared or is under way. */
  clear(): void {
    this._generation++;
    this._set({ kind: "idle" });
  }

  private _set(state: PreparationState<I, T>): void {
    this.state = state;
    this._host.requestUpdate();
  }
}
