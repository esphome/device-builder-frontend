/**
 * Pins the shipped CSP against the origins the app actually talks to.
 *
 * The policy lives in a static `public/index.html` meta tag while the origins
 * live in TypeScript, so nothing but this connects the two. A feature that
 * reaches a new origin passes every other test and is then dead on arrival in
 * the browser: the test environment does not enforce CSP, and the suite never
 * loads this file. That is exactly how the decoder iframe shipped blocked.
 */
import { describe, expect, it } from "vitest";
import { DECODER_ORIGIN, DECODER_URL } from "../../src/common/docs.js";
// The shipped file itself, not a copy of its text: a policy asserted against a
// duplicate would pass while the real page blocked everything.
import html from "../../public/index.html?raw";

// Find the CSP meta tag, then read its content, so attribute order or an added
// attribute (a reformat) doesn't break the test while the policy is unchanged.
const cspMeta = /<meta\b[^>]*\bhttp-equiv="Content-Security-Policy"[^>]*>/i.exec(
  html
)?.[0];
const csp = cspMeta ? (/\bcontent="([^"]*)"/i.exec(cspMeta)?.[1] ?? "") : "";

/** One directive's values, or the empty string when it isn't declared. */
const directive = (name: string): string =>
  csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `))
    ?.slice(name.length)
    .trim() ?? "";

describe("the shipped Content-Security-Policy", () => {
  it("is present, so the rest of these assertions mean something", () => {
    expect(csp).toContain("default-src 'self'");
  });

  it("lets the stack-trace decoder be framed", () => {
    // frame-src falls back through child-src to default-src 'self', so an
    // undeclared directive blocks the decoder outright and every crash on a
    // remote-built device silently stays raw.
    expect(directive("frame-src")).toContain(DECODER_URL);
  });

  it("grants framing to the decoder's page, not to everything on its origin", () => {
    // esphome.github.io serves every project's Pages site. The path scopes the
    // grant to the one page we frame; CSP matches source expressions by path.
    expect(directive("frame-src")).not.toBe(DECODER_ORIGIN);
  });

  it("does not let the decoder's origin do anything but be framed", () => {
    // It is handed firmware. Framing is all it needs; a script-src or
    // connect-src entry for it would be a different, much larger grant. Assert
    // the origin is absent from each rather than that the directive is bare, so
    // tightening the CSP for unrelated reasons doesn't trip this.
    expect(directive("connect-src")).not.toContain(DECODER_ORIGIN);
    expect(directive("script-src")).not.toContain(DECODER_ORIGIN);
    expect(directive("default-src")).not.toContain(DECODER_ORIGIN);
  });
});
