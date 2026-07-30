/**
 * Re-attach a job follow once the reconnect's auth lands.
 *
 * The job keeps running server-side across a WS drop. The generation
 * capture separates a genuine reconnect from a refused send that lands
 * with 'ready' still resolved; 'giveUp' runs on the paths that will
 * never resume so the run reaches a terminal state instead of pinning
 * as live. A stale run (dismissed, stopped, or already reattached)
 * resolves silently.
 */
export function resumeFollowOnReady(
  api: { ready: Promise<void>; connectionGeneration: number },
  hooks: {
    isStale: () => boolean;
    resume: () => void;
    giveUp: (err: unknown) => void;
  }
): void {
  const generation = api.connectionGeneration;
  let gaveUp = false;
  const giveUp = (err: unknown): void => {
    if (gaveUp) return;
    gaveUp = true;
    hooks.giveUp(err);
  };
  void api.ready
    .then(() => {
      if (hooks.isStale()) return;
      if (api.connectionGeneration === generation) {
        giveUp(new Error("send refused with no reconnect"));
        return;
      }
      hooks.resume();
    })
    .catch(giveUp);
}
