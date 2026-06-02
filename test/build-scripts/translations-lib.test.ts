import { describe, expect, it } from "vitest";
import {
  flagValue,
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
