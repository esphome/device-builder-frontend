/**
 * Tests for the link-scheme validator that gates the inline-Markdown
 * renderer. Catalog descriptions are repo-controlled today (board
 * manifests, schema-derived component docstrings), so a
 * ``[click me](javascript:alert(1))`` can't be injected by an
 * external attacker — the validator is defense in depth against a
 * future supply-chain compromise of the catalog data. See
 * esphome/device-builder#120 (F-1).
 *
 * Vitest runs in a Node environment here (no DOM, no Lit render
 * target), so we test the pure ``isSafeLinkHref`` predicate
 * directly — it's the security boundary; the
 * ``if (!isSafeLinkHref(seg.href)) return seg.text`` branch in
 * ``renderSegment`` is trivially provable by reading the code.
 */

import { describe, expect, it } from "vitest";

import { isSafeLinkHref, splitTextLinks } from "../../src/util/markdown.js";

describe("isSafeLinkHref — accepted schemes", () => {
  it("accepts http://", () => {
    expect(isSafeLinkHref("http://esphome.io/foo")).toBe(true);
  });

  it("accepts https://", () => {
    expect(isSafeLinkHref("https://esphome.io/foo")).toBe(true);
  });

  it("accepts mailto:", () => {
    expect(isSafeLinkHref("mailto:dev@example.com")).toBe(true);
  });

  it("is case-insensitive on the scheme", () => {
    // Browsers treat ``HTTPS:`` and ``https:`` as equivalent;
    // matching that lets uppercase-shouted URLs in catalog text
    // still render as anchors.
    expect(isSafeLinkHref("HTTPS://esphome.io")).toBe(true);
    expect(isSafeLinkHref("MAILTO:dev@example.com")).toBe(true);
    expect(isSafeLinkHref("HtTp://mixed.example.com")).toBe(true);
  });

  it("ignores leading whitespace before the scheme", () => {
    // Markdown-in-the-wild often has stray spaces in
    // ``[text]( https://…)``. The renderer is forgiving about
    // these so a single space doesn't make a docs link silently
    // fall back to plain text.
    expect(isSafeLinkHref(" https://esphome.io")).toBe(true);
    expect(isSafeLinkHref("\thttps://esphome.io")).toBe(true);
    expect(isSafeLinkHref("\nhttps://esphome.io")).toBe(true);
  });
});

describe("isSafeLinkHref — rejected schemes", () => {
  it("rejects javascript:", () => {
    // The whole reason this validator exists.
    expect(isSafeLinkHref("javascript:alert(1)")).toBe(false);
    // Mixed-case spelling — historical XSS vector when the
    // sanitiser was case-sensitive.
    expect(isSafeLinkHref("JaVaScRiPt:alert(1)")).toBe(false);
  });

  it("rejects data: URIs", () => {
    // ``data:text/html;…`` would let an injected catalog
    // description carry a base64-encoded HTML payload.
    expect(
      isSafeLinkHref("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==")
    ).toBe(false);
  });

  it("rejects vbscript:", () => {
    expect(isSafeLinkHref("vbscript:msgbox(1)")).toBe(false);
  });

  it("rejects file: URIs", () => {
    // Local-file URIs would let a malicious link reveal
    // dashboard-process filesystem layout when clicked in a
    // browser that honours ``file://``.
    expect(isSafeLinkHref("file:///etc/passwd")).toBe(false);
  });

  it("rejects scheme-less / relative URLs", () => {
    // Strict-or-text: the catalog uses absolute URLs, so
    // anything without one of the allowlisted schemes falls
    // back to plain text rather than getting browser-native
    // resolution behaviour we can't reason about.
    expect(isSafeLinkHref("/foo")).toBe(false);
    expect(isSafeLinkHref("foo/bar")).toBe(false);
    expect(isSafeLinkHref("#section")).toBe(false);
    expect(isSafeLinkHref("//example.com/x")).toBe(false);
    expect(isSafeLinkHref("example.com/x")).toBe(false);
  });

  it("rejects empty / undefined href", () => {
    expect(isSafeLinkHref(undefined)).toBe(false);
    expect(isSafeLinkHref("")).toBe(false);
    expect(isSafeLinkHref("   ")).toBe(false);
  });

  it("rejects javascript: even when prefixed with control chars", () => {
    // Browsers can be tricked by tab / newline / NUL bytes
    // before the scheme (historic XSS bypass). Leading
    // whitespace is allowed (Markdown forgiveness), but a
    // ``javascript`` body still has to follow — and the regex
    // only matches the scheme name, so a tab + ``javascript:``
    // is text either way. Test fixes the contract so a future
    // tweak can't accidentally widen the prefix.
    expect(isSafeLinkHref("\tjavascript:alert(1)")).toBe(false);
    expect(isSafeLinkHref("\njavascript:alert(1)")).toBe(false);
  });
});

describe("splitTextLinks", () => {
  it("returns a single text segment when there is no URL", () => {
    expect(splitTextLinks("Invalid POSIX timezone string 'CDT'")).toEqual([
      { text: "Invalid POSIX timezone string 'CDT'" },
    ]);
  });

  it("links a bare URL and keeps a trailing period as text", () => {
    // The real esphome timezone error: the sentence-ending period
    // must not become part of the href.
    expect(
      splitTextLinks(
        "check the list at https://en.wikipedia.org/wiki/List_of_tz_database_time_zones."
      )
    ).toEqual([
      { text: "check the list at " },
      {
        text: "https://en.wikipedia.org/wiki/List_of_tz_database_time_zones",
        href: "https://en.wikipedia.org/wiki/List_of_tz_database_time_zones",
      },
      { text: "." },
    ]);
  });

  it("links a URL embedded mid-sentence", () => {
    expect(splitTextLinks("see https://esphome.io/foo for details")).toEqual([
      { text: "see " },
      { text: "https://esphome.io/foo", href: "https://esphome.io/foo" },
      { text: " for details" },
    ]);
  });

  it("links each of several URLs", () => {
    const segs = splitTextLinks("https://a.example and https://b.example");
    expect(segs.filter((s) => s.href).map((s) => s.href)).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("keeps a paren inside the URL but peels an unbalanced trailing one", () => {
    // Wikipedia-style '_(disambiguation)' stays in the link; a closing
    // paren with no opener (prose wrapping) is pushed back to text.
    expect(splitTextLinks("https://en.wikipedia.org/wiki/Foo_(bar)")).toEqual([
      {
        text: "https://en.wikipedia.org/wiki/Foo_(bar)",
        href: "https://en.wikipedia.org/wiki/Foo_(bar)",
      },
    ]);
    expect(splitTextLinks("(see https://esphome.io/foo)")).toEqual([
      { text: "(see " },
      { text: "https://esphome.io/foo", href: "https://esphome.io/foo" },
      { text: ")" },
    ]);
  });
});
