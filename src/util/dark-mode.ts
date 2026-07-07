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
  try {
    const saved =
      (localStorage.getItem(THEME_STORAGE_KEY) as Theme | null) ?? Theme.SYSTEM;
    return themeIsDark(saved);
  } catch {
    return false;
  }
}
