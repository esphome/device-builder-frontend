import type { ReactiveControllerHost } from "lit";

/** Why a picked file cannot be installed, in the dialog's words. */
export interface PreparationFailure {
  title: string;
  detail: string;
  /**
   * The file may be fine: a chunk its check needs did not load. It is kept
   * and checked again; any other failure is the file's, and drops it.
   */
  retryable?: boolean;
}

export type FilePreparationState<T> =
  | { kind: "idle" }
  | { kind: "pending"; file: File }
  | { kind: "ready"; file: File; value: T }
  | ({ kind: "failed"; file: File } & PreparationFailure);

/**
 * Reads and checks a file when it is picked, not when Install is clicked. A
 * device picker needs the click's user activation, which does not outlast
 * reading a file and fetching the chunk that parses it, so a dialog offers
 * its install only in the ``ready`` state and the click goes straight to
 * the picker. A file that is not firmware is also named before a port is
 * asked for.
 */
export class FilePreparation<T> {
  state: FilePreparationState<T> = { kind: "idle" };

  // Supersedes a preparation that a newer pick, or a clear, overtook.
  private _generation = 0;

  constructor(
    private readonly _host: ReactiveControllerHost,
    /** Read and parse ``file``; never throws. */
    private readonly _prepare: (file: File) => Promise<{ value: T } | PreparationFailure>,
    private readonly _onFailed: (failure: PreparationFailure) => void
  ) {}

  /** The picked file, whatever came of it. */
  get file(): File | null {
    return this.state.kind === "idle" ? null : this.state.file;
  }

  /** Prepare ``file``; a pick of nothing drops what was prepared. */
  start(file: File | null): void {
    const generation = ++this._generation;
    if (!file) {
      this._set({ kind: "idle" });
      return;
    }
    this._set({ kind: "pending", file });
    void this._prepare(file).then((result) => {
      if (generation !== this._generation) return;
      if ("value" in result) {
        this._set({ kind: "ready", file, value: result.value });
        return;
      }
      this._set({ kind: "failed", file, ...result });
      this._onFailed(result);
    });
  }

  /**
   * Back from the failure view: check the file again when it may be fine,
   * else drop it so another one is picked.
   */
  recover(): void {
    if (this.state.kind !== "failed") return;
    this.start(this.state.retryable ? this.state.file : null);
  }

  clear(): void {
    this.start(null);
  }

  private _set(state: FilePreparationState<T>): void {
    this.state = state;
    this._host.requestUpdate();
  }
}
