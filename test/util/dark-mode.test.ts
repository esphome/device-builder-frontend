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
  persistTheme,
  storedTheme,
  THEME_STORAGE_KEY,
  themeIsDark,
} from "../../src/util/dark-mode.js";

afterEach(() => {
  // Unstub first: the storage-throws test replaces localStorage with an
  // object that has no removeItem. stubGlobal restores whether or not
  // the environment defined the global in the first place — happy-dom
  // shares one window per suite file, so a leaked stub would bleed into
  // later tests.
  vi.unstubAllGlobals();
  localStorage.removeItem(THEME_STORAGE_KEY);
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

  it("returns false for SYSTEM when matchMedia is unavailable", () => {
    // The guard that keeps field initializers safe in environments
    // without a matchMedia implementation.
    vi.stubGlobal("matchMedia", undefined);
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

  it("returns false when localStorage access throws", () => {
    // Privacy-mode / blocked-storage guard: the catch is what makes
    // the util safe to call from every consumer's field initializer.
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("denied");
      },
    });
    expect(initialDarkMode()).toBe(false);
  });
});

describe("persistTheme", () => {
  it("round-trips through storedTheme", () => {
    persistTheme(Theme.DARK);
    expect(storedTheme()).toBe(Theme.DARK);
  });

  it("drops the write when storage throws, so the switch still applies", () => {
    vi.stubGlobal("localStorage", {
      setItem() {
        throw new Error("denied");
      },
    });
    expect(() => persistTheme(Theme.DARK)).not.toThrow();
  });
});
