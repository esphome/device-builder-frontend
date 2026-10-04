/**
 * Pins the shipped CSP against the origins the app actually talks to.
 *
 * The policies live in static meta tags in `public/index.html` and
 * `public/web/index.html` while the origins live in TypeScript, so nothing
 * but this connects the two. A feature that reaches a new origin passes every
 * other test and is then dead on arrival in the browser: the test environment
 * does not enforce CSP, and the suite never loads this file. That is exactly
 * how the decoder iframe shipped blocked.
 */
import { describe, expect, it } from "vitest";
// The shipped file itself, not a copy of its text: a policy asserted against a
// duplicate would pass while the real page blocked everything.
import html from "../../public/index.html?raw";
import webHtml from "../../public/web/index.html?raw";
import { DECODER_ORIGIN, DECODER_URL } from "../../src/common/docs.js";
import { LN882H_RAMCODE_URL } from "../../src/platforms/ln882x/ln882x-ramcode.js";

// Find the CSP meta tag, then read its content, so attribute order or an added
// attribute (a reformat) doesn't break the test while the policy is unchanged.
const policyOf = (page: string): string => {
  const meta = /<meta\b[^>]*\bhttp-equiv="Content-Security-Policy"[^>]*>/i.exec(
    page
  )?.[0];
  return meta ? (/\bcontent="([^"]*)"/i.exec(meta)?.[1] ?? "") : "";
};
const csp = policyOf(html);

/** One directive's values in ``policy``, or the empty string when it isn't declared. */
const directiveIn = (policy: string, name: string): string =>
  policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `))
    ?.slice(name.length)
    .trim() ?? "";
const directive = (name: string): string => directiveIn(csp, name);

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

describe.each([
  ["the Device Builder", html],
  ["web.esphome.io", webHtml],
])("%s's Content-Security-Policy", (_name, page) => {
  it("lets the LN882H flasher fetch its RAM code, and nothing else from the CDN", () => {
    // A path ending in a slash matches everything under it; the grant is the
    // one ltchiptool release, not cdn.jsdelivr.net.
    const sources = directiveIn(policyOf(page), "connect-src").split(/\s+/);
    const grant = sources.find((src) => src.startsWith("https://cdn.jsdelivr.net/"));
    expect(grant).toBeDefined();
    expect(grant!.endsWith("/")).toBe(true);
    expect(LN882H_RAMCODE_URL.startsWith(grant!)).toBe(true);
    expect(grant).not.toBe("https://cdn.jsdelivr.net/");
  });
});
