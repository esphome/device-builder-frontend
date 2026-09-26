/**
 * ``work``, or ``timeout()``'s error once ``ms`` have passed without it
 * settling. The work itself keeps running; the caller decides what to do
 * about that (usually release whatever it was waiting on).
 */
export function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  timeout: () => Error
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeout()), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
