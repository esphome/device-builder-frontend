/**
 * What the flash of a LibreTiny chip over its serial adapter tells its
 * caller, the same for every family's engine, so that a flow written for
 * one takes another. Types only.
 */

/** What a flash reports while it runs. */
export interface LibreTinyFlashHooks {
  onProgress: (percent: number) => void;
  /** One line per step, for the install dialog's details log. */
  onLog?: (line: string) => void;
  /** The chip is linked and the write is starting. */
  onLinked?: () => void;
  /** The chip did not answer by itself; the user has to get it into its downloader. */
  onWaiting?: () => void;
  signal?: AbortSignal;
}

/**
 * How a flash ended. ``rebooted`` is false when the board has to be reset by
 * hand; a failure comes back as its detail, with the error for a flow that
 * has a line of its own for it, and as ``key`` the copy of its own where it
 * has one.
 */
export type LibreTinyFlashResult =
  { rebooted: boolean } | { detail: string; error: unknown; key?: string };
