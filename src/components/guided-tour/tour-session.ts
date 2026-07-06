/**
 * Cross-component signal for the device name the guided tour suggests.
 *
 * The create wizard is hosted by the dashboard page, not the app shell, so the
 * tour can't prop-drill a suggested name into it. Instead the overlay stamps a
 * sessionStorage key when the tour starts; the wizard's name step reads it once
 * to pre-fill the field. Mirrors the ``markJustCreated`` sessionStorage idiom.
 */

const SUGGESTED_NAME_KEY = "esphome.tour-suggested-name";

export function setTourSuggestedName(name: string): void {
  try {
    sessionStorage.setItem(SUGGESTED_NAME_KEY, name);
  } catch {
    // Private-mode / disabled storage: pre-fill is a nicety, not load-bearing.
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
    // No-op — see setTourSuggestedName.
  }
}
