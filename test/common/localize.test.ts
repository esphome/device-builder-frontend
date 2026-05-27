// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activeLocale,
  clearStoredLocale,
  defaultLocalize,
} from "../../src/common/localize.js";

describe("defaultLocalize", () => {
  it("resolves a top-level string key", () => {
    expect(defaultLocalize("dashboard.title")).toBe("ESPHome - Device Builder");
  });

  it("resolves a deeply nested key", () => {
    expect(defaultLocalize("wizard.tag.esp32")).toBe("ESP32");
  });

  it("returns the key unchanged when missing", () => {
    expect(defaultLocalize("does.not.exist")).toBe("does.not.exist");
  });

  it("returns the key unchanged when traversal hits a string mid-path", () => {
    expect(defaultLocalize("dashboard.title.sub")).toBe("dashboard.title.sub");
  });

  it("returns the key unchanged when the resolved value is not a string", () => {
    expect(defaultLocalize("wizard.tag")).toBe("wizard.tag");
  });

  it("interpolates {variable} placeholders", () => {
    const out = defaultLocalize("dashboard.discovered_count_plural", {
      count: 3,
    });
    expect(out).toBe("Discovered 3 devices");
  });

  it("interpolates multiple placeholders", () => {
    const out = defaultLocalize("dashboard.pagination_page_of", {
      current: 2,
      total: 7,
    });
    expect(out).toBe("Page 2 of 7");
  });

  it("leaves unknown placeholders intact", () => {
    const out = defaultLocalize("dashboard.discovered_count_singular", {});
    expect(out).toBe("Discovered {count} device");
  });

  it("coerces numeric values to strings", () => {
    const out = defaultLocalize("dashboard.update_selected", { count: 5 });
    expect(out).toBe("Update 5 device(s)");
  });
});

describe("activeLocale (browser detection fallback)", () => {
  let originalLanguage: PropertyDescriptor | undefined;

  beforeEach(() => {
    clearStoredLocale();
    originalLanguage = Object.getOwnPropertyDescriptor(navigator, "language");
  });

  afterEach(() => {
    clearStoredLocale();
    if (originalLanguage !== undefined) {
      Object.defineProperty(navigator, "language", originalLanguage);
    } else {
      // ``navigator.language`` lives on the prototype by default,
      // so the previous descriptor was ``undefined``. Drop the
      // own-property override we installed via ``setLanguage`` so
      // the next test reads through to the prototype again and
      // doesn't observe the previous stub.
      delete (navigator as { language?: string }).language;
    }
  });

  const setLanguage = (value: string): void => {
    Object.defineProperty(navigator, "language", {
      configurable: true,
      get: () => value,
    });
  };

  it("matches exact supported locale codes (zh-CN)", () => {
    setLanguage("zh-CN");
    expect(activeLocale()).toBe("zh-CN");
  });

  it("matches case-insensitive variants of the locale tag", () => {
    // BCP 47 tags are case-insensitive; a browser may report any
    // casing. The canonical ``zh-CN`` is still what we return.
    setLanguage("zh-cn");
    expect(activeLocale()).toBe("zh-CN");
  });

  it("falls back to language prefix for regional variants (fr-CA)", () => {
    setLanguage("fr-CA");
    expect(activeLocale()).toBe("fr");
  });

  it("falls back to language prefix for nl-BE", () => {
    setLanguage("nl-BE");
    expect(activeLocale()).toBe("nl");
  });

  it("falls back to en for zh-TW since zh is not a supported prefix", () => {
    // Regression guard: zh-CN must not capture zh-TW / zh-HK / zh-MO /
    // zh-SG via a bare `zh` prefix entry that doesn't exist.
    setLanguage("zh-TW");
    expect(activeLocale()).toBe("en");
  });

  it("falls back to en for unsupported languages", () => {
    setLanguage("de-DE");
    expect(activeLocale()).toBe("en");
  });

  it("matches exact base language (fr)", () => {
    setLanguage("fr");
    expect(activeLocale()).toBe("fr");
  });
});
