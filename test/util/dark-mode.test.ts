/**
 * @vitest-environment happy-dom
 *
 * Pins the shared theme -> dark-mode resolution so every
 * darkModeContext consumer's fallback initializer agrees with what
 * app-shell will provide.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Theme } from "../../src/api/types/system.js";
import {
  initialDarkMode,
  THEME_STORAGE_KEY,
  themeIsDark,
} from "../../src/util/dark-mode.js";

afterEach(() => {
  localStorage.removeItem(THEME_STORAGE_KEY);
  // stubGlobal restores whether or not the environment defined
  // matchMedia in the first place — happy-dom shares one window per
  // suite file, so a leaked stub would bleed into later tests.
  vi.unstubAllGlobals();
});

function mockPrefersDark(matches: boolean): void {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches } as MediaQueryList));
}

describe("themeIsDark", () => {
  it("maps the explicit themes directly", () => {
    expect(themeIsDark(Theme.DARK)).toBe(true);
    expect(themeIsDark(Theme.LIGHT)).toBe(false);
  });

  it("resolves SYSTEM through the prefers-color-scheme query", () => {
    mockPrefersDark(true);
    expect(themeIsDark(Theme.SYSTEM)).toBe(true);
    mockPrefersDark(false);
    expect(themeIsDark(Theme.SYSTEM)).toBe(false);
  });
});

describe("initialDarkMode", () => {
  it("reads the persisted theme app-shell stores", () => {
    localStorage.setItem(THEME_STORAGE_KEY, Theme.DARK);
    expect(initialDarkMode()).toBe(true);
    localStorage.setItem(THEME_STORAGE_KEY, Theme.LIGHT);
    expect(initialDarkMode()).toBe(false);
  });

  it("falls back to the OS preference with nothing persisted", () => {
    mockPrefersDark(true);
    expect(initialDarkMode()).toBe(true);
  });
});
