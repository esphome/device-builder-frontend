// Pure parsing/building of the device page's URL query state.
//
// The device page persists three pieces of view state in the query
// string: the selected section (`section`), the line within it
// (`line`), and the set of open navigator sections (`open`). Keeping
// the parse/build logic free of `window` makes the edge cases —
// notably #650 (empty/non-numeric `open` fragments) — unit-testable.
//
// The component keeps the thin `window.location` / `history` wrappers;
// everything that turns a search string into values, or values into a
// new URL, lives here. The `history.state` preservation in `_updateUrl`
// stays in the component wrapper — this module only builds the
// `pathname?query` string and never touches `history.state`.

/**
 * Read a single query param, returning `fallback` when absent. The
 * device page wraps this with its own overloads to narrow the return
 * type per call site; here a single `string | null` signature keeps the
 * helper composable.
 */
export function readUrlParam(
  search: string,
  key: string,
  fallback: string | null
): string | null {
  return new URLSearchParams(search).get(key) ?? fallback;
}

/** Parse the `line` param to a number, or `undefined` if absent/NaN. */
export function readUrlLine(search: string): number | undefined {
  const raw = new URLSearchParams(search).get("line");
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}

/** Parse the comma-separated `open` param into section indices. */
export function readUrlSections(search: string): number[] {
  const raw = new URLSearchParams(search).get("open");
  if (!raw) return [];
  // Section indices are numeric, so a value can never contain a comma —
  // ``split(",")`` is safe. ``map(Number)`` then ``filter(!isNaN)``
  // discards non-numeric fragments; an empty fragment coerces to ``0``
  // (a valid index), not ``NaN`` (#650).
  return raw
    .split(",")
    .map(Number)
    .filter((n) => !Number.isNaN(n));
}

export interface DeviceUrlState {
  selectedSection: string | null;
  selectedFromLine: number | undefined;
  openSections: Iterable<number>;
}

/**
 * Build the device page URL for the given view state, starting from the
 * current query string so unrelated params are preserved. Returns the
 * `pathname?query` string to feed to `history.replaceState`.
 */
export function buildDeviceUrl(
  search: string,
  pathname: string,
  state: DeviceUrlState
): string {
  const params = new URLSearchParams(search);

  // Selected section + line
  if (state.selectedSection) {
    params.set("section", state.selectedSection);
    if (state.selectedFromLine !== undefined) {
      params.set("line", String(state.selectedFromLine));
    } else {
      params.delete("line");
    }
  } else {
    params.delete("section");
    params.delete("line");
  }

  // Open navigator sections
  const open = [...state.openSections];
  if (open.length > 0) {
    // `params.toString()` percent-encodes the comma, so `open`
    // serializes as e.g. `0%2C2%2C5`. That encoding is inherited from
    // the original `_updateUrl` and is intentional — don't "fix" it to a
    // raw comma, which would silently change the emitted URL.
    params.set("open", open.join(","));
  } else {
    params.delete("open");
  }

  const qs = params.toString();
  return `${pathname}${qs ? `?${qs}` : ""}`;
}
