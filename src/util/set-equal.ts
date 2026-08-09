/** Same members, order-independent. */
export function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

/** Same items in the same order. */
export function arraysEqual<T>(
  a: readonly T[],
  b: readonly T[],
  equals: (x: T, y: T) => boolean = (x, y) => x === y
): boolean {
  return a.length === b.length && a.every((v, i) => equals(v, b[i]));
}
