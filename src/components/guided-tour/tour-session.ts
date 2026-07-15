const SUGGESTED_NAME_KEY = "esphome.tour-suggested-name";
const TOUR_PENDING_KEY = "esphome.quickstart-tour-pending";
const TOUR_CONFIGURATION_KEY = "esphome.quickstart-tour-configuration";
export const TOUR_ACTIVE_CHANGE_EVENT = "esphome-tour-active-change";
let tourActive = false;

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

export function setTourPending(stepIndex = 0): void {
  try {
    localStorage.setItem(TOUR_PENDING_KEY, String(stepIndex));
  } catch {
    // Persistence is best-effort when browser storage is unavailable.
  }
}

export function getPendingTourStep(): number | null {
  try {
    const raw = localStorage.getItem(TOUR_PENDING_KEY);
    if (raw === null) return null;
    if (raw === "true") return 0;
    const step = Number(raw);
    return Number.isInteger(step) && step >= 0 ? step : 0;
  } catch {
    return null;
  }
}

export function isTourPending(): boolean {
  return getPendingTourStep() !== null;
}

export function clearTourPending(): void {
  try {
    localStorage.removeItem(TOUR_PENDING_KEY);
  } catch {
    // Persistence is best-effort when browser storage is unavailable.
  }
}

export function setTourConfiguration(configuration: string): void {
  try {
    localStorage.setItem(TOUR_CONFIGURATION_KEY, configuration);
  } catch {
    // Persistence is best-effort when browser storage is unavailable.
  }
}

export function getTourConfiguration(): string | null {
  try {
    return localStorage.getItem(TOUR_CONFIGURATION_KEY);
  } catch {
    return null;
  }
}

export function clearTourConfiguration(): void {
  try {
    localStorage.removeItem(TOUR_CONFIGURATION_KEY);
  } catch {
    // Persistence is best-effort when browser storage is unavailable.
  }
}

export function setTourActive(active: boolean): void {
  if (tourActive === active) return;
  tourActive = active;
  window.dispatchEvent(new Event(TOUR_ACTIVE_CHANGE_EVENT));
}

export function isTourActive(): boolean {
  return tourActive;
}

export function getActiveTourConfiguration(): string | null {
  return tourActive ? getTourConfiguration() : null;
}
