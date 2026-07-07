import { Theme } from "../api/types/system.js";

/** localStorage key ``app-shell`` persists the chosen theme under. */
export const THEME_STORAGE_KEY = "esphome-theme";

/** Resolve a theme choice to a concrete dark-mode boolean. */
export function themeIsDark(theme: Theme): boolean {
  if (theme === Theme.SYSTEM) {
    return typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false;
  }
  return theme === Theme.DARK;
}

/** The persisted theme choice, or ``SYSTEM`` when nothing is stored or
 *  storage access throws (private mode / sandboxed iframe — any
 *  localStorage call can throw, see ``split-ratio.ts`` for the same
 *  treatment). */
export function storedTheme(): Theme {
  try {
    return (localStorage.getItem(THEME_STORAGE_KEY) as Theme | null) ?? Theme.SYSTEM;
  } catch {
    return Theme.SYSTEM;
  }
}

/** Persist the chosen theme; drops the write when storage is
 *  unavailable so theme switching still applies for the session. */
export function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Blocked storage must not break the theme switch itself.
  }
}

/**
 * The dark-mode value ``app-shell`` will provide once it connects,
 * computed the same way it computes it (persisted theme, falling back
 * to the OS preference).
 *
 * Use this as the ``@consume(darkModeContext)`` fallback initializer so
 * a component's first paint agrees with the provider instead of
 * hardcoding ``true`` or ``false`` — consumers used to disagree with
 * each other, which showed as a one-frame theme flash in heavy dialogs
 * and as divergent defaults in provider-less tests.
 */
export function initialDarkMode(): boolean {
  return themeIsDark(storedTheme());
}
