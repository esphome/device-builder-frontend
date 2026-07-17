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
import { DECODER_ORIGIN } from "../../src/common/docs.js";
// The shipped file itself, not a copy of its text: a policy asserted against a
// duplicate would pass while the real page blocked everything.
import html from "../../public/index.html?raw";

const csp =
  /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? "";

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
    expect(directive("frame-src")).toContain(DECODER_ORIGIN);
  });

  it("does not let the decoder's origin do anything but be framed", () => {
    // It is handed firmware. Framing is all it needs; a script-src or
    // connect-src entry would be a different, much larger grant.
    expect(directive("connect-src")).not.toContain(DECODER_ORIGIN);
    expect(directive("script-src")).toBe("");
    expect(directive("default-src")).not.toContain(DECODER_ORIGIN);
  });
});
