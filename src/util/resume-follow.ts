/**
 * Re-attach a job follow once the reconnect's auth lands.
 *
 * The job keeps running server-side across a WS drop. The generation
 * capture separates a genuine reconnect from a refused send that lands
 * with 'ready' still resolved; 'giveUp' runs on the paths that will
 * never resume. A stale run (dismissed, stopped, or already
 * reattached) resolves silently.
 */
export function resumeFollowOnReady(
  api: { ready: Promise<void>; connectionGeneration: number },
  hooks: {
    isStale: () => boolean;
    resume: () => void;
    giveUp: () => void;
  }
): void {
  const generation = api.connectionGeneration;
  const fail = (err: unknown): void => {
    if (hooks.isStale()) return;
    console.error("[WS] Re-follow after reconnect failed", err);
    hooks.giveUp();
  };
  void api.ready.then(() => {
    if (hooks.isStale()) return;
    if (api.connectionGeneration === generation) {
      fail(new Error("send refused with no reconnect"));
      return;
    }
    try {
      hooks.resume();
    } catch (err) {
      fail(err);
    }
  }, fail);
}
