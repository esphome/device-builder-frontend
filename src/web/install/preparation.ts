import type { ReactiveControllerHost } from "lit";

/** What a preparation came to: its value, or why there is none. */
export type Prepared<T, F> = { value: T } | { failure: F; retryable: boolean };

export type PreparationState<I, T> =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "ready"; value: T }
  /** A chunk the check needs did not load; the input is kept to try again. */
  | { kind: "retryable"; input: I };

/** The line for tools that did not load, where Retry loads them again. */
export const TOOLS_LOAD_FAILED = "web.install.tools_load_failed";

/**
 * The line and the retry of a parse that failed with ``key``. Tools that did
 * not load can be loaded again with the same input, and their line must not
 * send the user to reload the page, which would lose what was picked or
 * handed over.
 */
export function parseFailureCopy(key: string): { key: string; retryable: boolean } {
  return key === "firmware.engine_load_failed"
    ? { key: TOOLS_LOAD_FAILED, retryable: true }
    : { key, retryable: false };
}

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
    private readonly _prepare: (input: I) => Promise<Prepared<T, F>>,
    /** A preparation ended: with why it failed, or null when ready. */
    private readonly _onSettled: (failure: F | null) => void,
    /** Names a rejection of ``_prepare``, which drops the input. */
    private readonly _failureOf: (err: unknown) => F
  ) {}

  start(input: I): void {
    const generation = ++this._generation;
    this._set({ kind: "pending" });
    const prepared = this._prepare(input).catch((err: unknown): Prepared<T, F> => {
      // Shown as the input's failure, so a bug in the preparing is told apart here.
      console.error("[preparation] The preparing was rejected:", err);
      return { failure: this._failureOf(err), retryable: false };
    });
    void prepared.then((result) => {
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
