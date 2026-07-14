/**
 * @vitest-environment happy-dom
 *
 * Pins activeLocale()'s memoization contract: cached between calls,
 * invalidated by the same-tab stored-locale writers and by cross-tab
 * storage events for the locale key only.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activeLocale,
  AVAILABLE_LOCALES,
  clearStoredLocale,
  writeStoredLocale,
} from "../../src/common/localize.js";

// The dev bundle ships only "en"; register a second locale so a stored
// override is accepted and a cache flip is observable through the public API.
const TEST_LOCALE = "xx-test";

beforeEach(() => {
  AVAILABLE_LOCALES.push(TEST_LOCALE);
});

afterEach(() => {
  clearStoredLocale();
  const i = AVAILABLE_LOCALES.indexOf(TEST_LOCALE);
  if (i !== -1) AVAILABLE_LOCALES.splice(i, 1);
});

describe("activeLocale caching", () => {
  it("invalidates on the same-tab stored-locale writers", () => {
    clearStoredLocale();
    const detected = activeLocale();
    expect(activeLocale()).toBe(detected);

    writeStoredLocale(TEST_LOCALE);
    expect(activeLocale()).toBe(TEST_LOCALE);

    clearStoredLocale();
    expect(activeLocale()).toBe(detected);
  });

  it("invalidates on a cross-tab storage event for the locale key only", () => {
    clearStoredLocale();
    const detected = activeLocale();

    // Another tab's write lands directly in storage; only the matching
    // storage event busts the cache.
    localStorage.setItem("esphome-locale", TEST_LOCALE);
    expect(activeLocale()).toBe(detected);
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated-key" }));
    expect(activeLocale()).toBe(detected);
    window.dispatchEvent(new StorageEvent("storage", { key: "esphome-locale" }));
    expect(activeLocale()).toBe(TEST_LOCALE);

    // key === null is a full storage clear.
    localStorage.removeItem("esphome-locale");
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(activeLocale()).toBe(detected);
  });
});
