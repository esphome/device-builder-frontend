// Compile start/end wall-clocks keyed by firmware job id, kept outside the
// dialog so closing and reopening a running build (the command dialog leaves
// its job running in the background and reattaches via follow_job, which
// replays the buffered output) restores the true elapsed instead of restarting
// the clock from the replay. Bounded so a long session can't grow it forever.

interface CompileTiming {
  startedAt: number;
  endedAt: number | null;
}

const _timings = new Map<string, CompileTiming>();
const _MAX_ENTRIES = 200;

/** Record the compile start for a job the first time it is observed. */
export function markCompileStarted(jobId: string, at: number): void {
  if (!jobId || _timings.has(jobId)) return;
  if (_timings.size >= _MAX_ENTRIES) {
    const oldest = _timings.keys().next().value;
    if (oldest !== undefined) _timings.delete(oldest);
  }
  _timings.set(jobId, { startedAt: at, endedAt: null });
}

/** Freeze the compile end for a job the first time it is observed. */
export function markCompileEnded(jobId: string, at: number): void {
  const timing = _timings.get(jobId);
  if (timing && timing.endedAt === null) timing.endedAt = at;
}

/** The recorded timing for a job, or null if it was never observed here. */
export function getCompileTiming(jobId: string): CompileTiming | null {
  return _timings.get(jobId) ?? null;
}
