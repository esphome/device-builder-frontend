/** Escape a literal string for embedding in a RegExp pattern. */
export const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
