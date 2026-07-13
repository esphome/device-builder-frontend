const SUGGESTED_NAME_KEY = "esphome.tour-suggested-name";

export function setTourSuggestedName(name: string): void {
  try {
    sessionStorage.setItem(SUGGESTED_NAME_KEY, name);
  } catch {
    // sessionStorage can throw (private mode, storage disabled); the
    // suggested name is best-effort and the wizard falls back to its default.
  }
}

export function getTourSuggestedName(): string | null {
  try {
    return sessionStorage.getItem(SUGGESTED_NAME_KEY);
  } catch {
    return null;
  }
}

export function clearTourSuggestedName(): void {
  try {
    sessionStorage.removeItem(SUGGESTED_NAME_KEY);
  } catch {
    // Nothing to clear when storage is unavailable — the set failed too.
  }
}
