/** Case-insensitive substring match over a nav item's searchable terms. */
export function navItemMatches(query: string, ...terms: (string | undefined)[]): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return terms.some((t) => t !== undefined && t.toLowerCase().includes(q));
}
