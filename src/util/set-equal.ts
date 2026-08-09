/** Same members, order-independent. */
export function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

/** Same items in the same order; `===` per item unless `equals` is given. */
export function arraysEqual<T>(
  a: readonly T[],
  b: readonly T[],
  equals?: (x: T, y: T) => boolean
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (equals ? !equals(a[i], b[i]) : a[i] !== b[i]) return false;
  }
  return true;
}
