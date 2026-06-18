import { describe, expect, it } from "vitest";
import { defaultLocalize, matchLocale } from "../../src/common/localize.js";

describe("defaultLocalize", () => {
  it("resolves a top-level string key", () => {
    expect(defaultLocalize("dashboard.title")).toBe("ESPHome Device Builder");
  });

  it("resolves a deeply nested key", () => {
    expect(defaultLocalize("wizard.tag.esp32")).toBe("ESP32");
  });

  it("resolves the language translation-help keys", () => {
    expect(defaultLocalize("settings.language_help")).toBe(
      "Is your language missing or incomplete?"
    );
    expect(defaultLocalize("settings.language_help_link")).toBe("Help translate ESPHome");
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

  it("interpolates multiple placeholders", () => {
    const out = defaultLocalize("dashboard.pagination_page_of", {
      current: 2,
      total: 7,
    });
    expect(out).toBe("Page 2 of 7");
  });

  it("leaves unknown placeholders intact", () => {
    const out = defaultLocalize("dashboard.search_of", {});
    expect(out).toBe("of {total}");
  });

  it("coerces numeric values to strings", () => {
    const out = defaultLocalize("dashboard.update_selected_aria", { count: 5 });
    expect(out).toBe("Update 5 selected");
  });
});

describe("ICU MessageFormat", () => {
  it("selects the singular plural form (count: 1)", () => {
    expect(defaultLocalize("dashboard.discovered_count", { count: 1 })).toBe(
      "Discovered 1 device"
    );
  });

  it("selects the other plural form (count: 3)", () => {
    expect(defaultLocalize("dashboard.discovered_count", { count: 3 })).toBe(
      "Discovered 3 devices"
    );
  });

  it("substitutes the # token with the formatted count", () => {
    const out = defaultLocalize("dashboard.filter_menu_active", { count: 2 });
    expect(out).toBe("2 active filters");
    expect(out).not.toContain("#");
  });

  it("renders word-only plural keys (no #) by count", () => {
    expect(defaultLocalize("dashboard.device_count", { count: 1 })).toBe("device");
    expect(defaultLocalize("dashboard.device_count", { count: 4 })).toBe("devices");
  });

  it("falls back to the raw template when the plural arg is missing", () => {
    const out = defaultLocalize("dashboard.discovered_count", {});
    expect(out).toBe(
      "{count, plural, one {Discovered # device} other {Discovered # devices}}"
    );
  });

  it("leaves non-ICU strings with apostrophes untouched", () => {
    // ICU treats `'` as an escape char; these strings must never reach the
    // parser, so the apostrophe survives verbatim.
    expect(defaultLocalize("wizard.dont_know_board")).toBe(
      "I don't know what board I have"
    );
  });
});

describe("matchLocale (browser tag resolution)", () => {
  // The candidate list mirrors a fully-downloaded bundle. At runtime
  // it comes from whatever translation files the build shipped; here we
  // pin it so the matching logic is exercised independent of which JSON
  // files happen to be present in the working tree.
  const CANDIDATES = ["en", "fr", "nl", "hu", "zh-CN"] as const;

  it("matches exact supported locale codes (zh-CN)", () => {
    expect(matchLocale("zh-CN", CANDIDATES)).toBe("zh-CN");
  });

  it("matches case-insensitive variants of the locale tag", () => {
    // BCP 47 tags are case-insensitive; a browser may report any
    // casing. The canonical ``zh-CN`` is still what we return.
    expect(matchLocale("zh-cn", CANDIDATES)).toBe("zh-CN");
  });

  it("matches underscore-separated candidates against a hyphenated tag", () => {
    // Lokalise filenames may use underscores (`zh_CN`); a browser reports
    // BCP 47 hyphens (`zh-CN`). Matching is separator-agnostic and returns
    // the candidate verbatim (the discovery layer canonicalizes stems, but
    // matchLocale itself must stay underscore-tolerant).
    expect(matchLocale("zh-CN", ["en", "zh_CN"])).toBe("zh_CN");
  });

  it("matches an underscore-separated browser tag against hyphenated candidates", () => {
    expect(matchLocale("zh_CN", CANDIDATES)).toBe("zh-CN");
  });

  it("falls back to language prefix for regional variants (fr-CA)", () => {
    expect(matchLocale("fr-CA", CANDIDATES)).toBe("fr");
  });

  it("falls back to language prefix for nl-BE", () => {
    expect(matchLocale("nl-BE", CANDIDATES)).toBe("nl");
  });

  it("returns null for zh-TW since zh is not a candidate prefix", () => {
    // Regression guard: zh-CN must not capture zh-TW / zh-HK / zh-MO /
    // zh-SG via a bare `zh` prefix entry that doesn't exist.
    expect(matchLocale("zh-TW", CANDIDATES)).toBeNull();
  });

  it("returns null for unsupported languages", () => {
    expect(matchLocale("de-DE", CANDIDATES)).toBeNull();
  });

  it("matches exact base language (fr)", () => {
    expect(matchLocale("fr", CANDIDATES)).toBe("fr");
  });
});
