import { describe, expect, it } from "vitest";
import {
  flagValue,
  localeCompleteness,
  localeFromZipEntry,
  resolveDownloadSource,
  toBcp47,
} from "../../build-scripts/translations-lib.js";

describe("toBcp47", () => {
  it("hyphenates and canonicalizes Lokalise underscore codes", () => {
    expect(toBcp47("zh_CN")).toBe("zh-CN");
    expect(toBcp47("pt_BR")).toBe("pt-BR");
  });

  it("canonicalizes the casing of an already-hyphenated tag", () => {
    expect(toBcp47("zh-cn")).toBe("zh-CN");
  });

  it("passes a bare language code through unchanged", () => {
    expect(toBcp47("fr")).toBe("fr");
  });

  it("falls back to the hyphenated form for a tag Intl rejects", () => {
    // Intl.getCanonicalLocales throws RangeError on a structurally invalid
    // tag; the helper must swallow it and never throw.
    expect(toBcp47("123")).toBe("123");
  });
});

describe("localeFromZipEntry", () => {
  it("derives a locale from a flat entry name", () => {
    expect(localeFromZipEntry("fr.json")).toBe("fr");
  });

  it("canonicalizes a Lokalise underscore code to a BCP 47 filename stem", () => {
    expect(localeFromZipEntry("zh_CN.json")).toBe("zh-CN");
  });

  it("strips leading path segments before deriving the locale", () => {
    expect(localeFromZipEntry("nested/dir/pt_BR.json")).toBe("pt-BR");
  });

  it("returns null for a non-JSON entry", () => {
    expect(localeFromZipEntry("README.md")).toBeNull();
  });
});

describe("flagValue", () => {
  it("reads a `--flag value` pair", () => {
    expect(flagValue(["download", "--source", "release"], "--source")).toBe("release");
  });

  it("reads a `--flag=value` pair", () => {
    expect(flagValue(["download", "--source=release"], "--source")).toBe("release");
  });

  it("returns undefined when the flag is absent", () => {
    expect(flagValue(["download"], "--source")).toBeUndefined();
  });
});

describe("resolveDownloadSource", () => {
  it("defaults to lokalise when --source is absent", () => {
    expect(resolveDownloadSource(["download"])).toBe("lokalise");
  });

  it("reads an explicit --source value", () => {
    expect(resolveDownloadSource(["download", "--source", "release"])).toBe("release");
    expect(resolveDownloadSource(["download", "--source=lokalise"])).toBe("lokalise");
  });

  it("throws on a present-but-valueless --source instead of silently defaulting", () => {
    expect(() => resolveDownloadSource(["download", "--source"])).toThrow(
      /no value given/
    );
  });

  it("throws on an empty --source= value", () => {
    expect(() => resolveDownloadSource(["download", "--source="])).toThrow();
  });

  it("throws on an unknown --source value", () => {
    expect(() => resolveDownloadSource(["download", "--source", "bogus"])).toThrow(
      /got 'bogus'/
    );
  });
});

describe("localeCompleteness", () => {
  it("is 100% when every English key has a value", () => {
    expect(localeCompleteness({ a: "A", b: { c: "C" } }, { a: "x", b: { c: "y" } })).toBe(
      100
    );
  });

  it("counts a value identical to English as translated", () => {
    // Proper nouns / shared terms are legitimately the same string in both
    // languages; Lokalise counts them as translated, so we do too.
    expect(localeCompleteness({ a: "A", b: "B" }, { a: "A", b: "x" })).toBe(100);
  });

  it("ignores empty-string and missing values", () => {
    expect(localeCompleteness({ a: "A", b: "B" }, { a: "x", b: "" })).toBe(50);
    expect(localeCompleteness({ a: "A", b: "B" }, { a: "x" })).toBe(50);
  });

  it("ignores keys the locale carries that English has dropped", () => {
    expect(localeCompleteness({ a: "A", b: "B" }, { a: "x", stale: "z" })).toBe(50);
  });

  it("flattens nested keys on both sides", () => {
    const en = { a: { b: { c: "C" } } };
    expect(localeCompleteness(en, { a: { b: { c: "x" } } })).toBe(100);
    expect(localeCompleteness(en, { a: { b: {} } })).toBe(0);
  });

  it("skips non-string English leaves so they don't dilute the total", () => {
    expect(localeCompleteness({ a: "A", n: 1 }, { a: "x" })).toBe(100);
  });

  it("returns 100 when English has no translatable keys", () => {
    expect(localeCompleteness({}, { a: "x" })).toBe(100);
  });

  it("returns 0 when nothing is translated", () => {
    expect(localeCompleteness({ a: "A", b: "B" }, { other: "z" })).toBe(0);
  });

  it("never rounds a partial locale up to 100%", () => {
    const en: Record<string, string> = {};
    const locale: Record<string, string> = {};
    for (let i = 0; i < 200; i++) en[`k${i}`] = "v";
    for (let i = 0; i < 199; i++) locale[`k${i}`] = "v";
    // 199/200 = 99.5% would round to 100; the clamp keeps it honest at 99.
    expect(localeCompleteness(en, locale)).toBe(99);
  });

  it("shows at least 1% for a barely-started locale", () => {
    const en: Record<string, string> = {};
    for (let i = 0; i < 300; i++) en[`k${i}`] = "v";
    // 1/300 = 0.33% rounds to 0; the floor keeps the locale visible at 1.
    expect(localeCompleteness(en, { k0: "v" })).toBe(1);
  });

  it("reuses the flattened base across calls with the same base object", () => {
    // The generator measures every locale against one base object; the second
    // call here should hit the memoized base-leaf map rather than re-flatten.
    const en = { a: "A", b: "B" };
    expect(localeCompleteness(en, { a: "x" })).toBe(50);
    expect(localeCompleteness(en, { a: "x", b: "y" })).toBe(100);
  });

  it("rounds intermediate coverage to the nearest percent", () => {
    const en: Record<string, string> = {};
    const locale: Record<string, string> = {};
    for (let i = 0; i < 1000; i++) en[`k${i}`] = "v";
    for (let i = 0; i < 850; i++) locale[`k${i}`] = "v";
    expect(localeCompleteness(en, locale)).toBe(85);
  });
});
