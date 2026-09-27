/**
 * ``work``, or ``timeout()``'s error once ``ms`` have passed without it
 * settling. The work itself keeps running, abandoned: its late rejection is
 * swallowed here, and the caller decides what to do about whatever it was
 * waiting on (usually release it).
 */
export function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  timeout: () => Error
): Promise<T> {
  work.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeout()), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Whether ``work`` settled within ``ms``. For a best-effort teardown the
 * caller can only warn about; the work keeps running past the deadline.
 */
export function settledWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  const settled = work.then(
    () => true,
    () => true
  );
  return Promise.race([settled, deadline]).finally(() => clearTimeout(timer));
}
