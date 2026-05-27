/**
 * Tests for the deployment-base helpers.
 *
 * ``base-path.ts`` derives ``BASE_PATH`` once at module load from
 * ``document.currentScript.src`` (matching rspack's ``publicPath:
 * "auto"`` resolution). Routing, the WebSocket URL, and the hard-
 * coded ``/assets/...`` references all flow through ``withBase`` /
 * ``stripBase``, so a regression here breaks every deployment mode
 * that isn't a bare ``/`` mount — HA ingress, reverse-proxy
 * subpaths, the lot.
 *
 * Each scenario fakes ``document`` / ``window`` on ``globalThis``
 * and re-imports the module via ``vi.resetModules()`` so the
 * top-level ``BASE_PATH`` IIFE re-runs against the new globals.
 * The ``stripBase`` boundary case ("/foo" must NOT match
 * "/foobar/...") is the one Copilot flagged on the original PR;
 * pin it explicitly.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

type Globals = Record<string, unknown>;

function setGlobals(opts: { scriptSrc?: string; pathname?: string }): void {
  const g = globalThis as Globals;
  // Fake HTMLScriptElement so the ``script instanceof HTMLScriptElement``
  // guard in ``base-path.ts`` doesn't throw on the missing constructor.
  class FakeScript {
    src = "";
  }
  g.HTMLScriptElement = FakeScript;
  if (opts.scriptSrc !== undefined) {
    const script = new FakeScript();
    script.src = opts.scriptSrc;
    g.document = { currentScript: script };
  } else {
    g.document = { currentScript: null };
  }
  if (opts.pathname !== undefined) {
    g.window = { location: { pathname: opts.pathname } };
  }
}

function clearGlobals(): void {
  const g = globalThis as Globals;
  delete g.document;
  delete g.window;
  delete g.HTMLScriptElement;
}

async function loadModule() {
  vi.resetModules();
  return await import("../../src/util/base-path.js");
}

afterEach(() => {
  clearGlobals();
  vi.resetModules();
});

describe("BASE_PATH derivation", () => {
  it("falls back to '/' when neither document nor window is available", async () => {
    // No globals — the Node-test guard short-circuits both branches.
    const { BASE_PATH } = await loadModule();
    expect(BASE_PATH).toBe("/");
  });

  it("derives '/' from a root-mounted entry script", async () => {
    setGlobals({ scriptSrc: "https://example.com/app.abc123.js" });
    const { BASE_PATH } = await loadModule();
    expect(BASE_PATH).toBe("/");
  });

  it("derives the HA ingress prefix from the entry script URL", async () => {
    setGlobals({
      scriptSrc: "http://homeassistant.local:8123/api/hassio_ingress/TOKEN/app.abc123.js",
    });
    const { BASE_PATH } = await loadModule();
    expect(BASE_PATH).toBe("/api/hassio_ingress/TOKEN/");
  });

  it("derives a reverse-proxy subpath from the entry script URL", async () => {
    setGlobals({ scriptSrc: "https://example.com/some/prefix/app.abc123.js" });
    const { BASE_PATH } = await loadModule();
    expect(BASE_PATH).toBe("/some/prefix/");
  });

  it("falls back to window.location.pathname when no script is present", async () => {
    // currentScript is null (e.g., async chunk loaded after document
    // parse) but window.location is still available.
    setGlobals({ pathname: "/some/prefix/" });
    const { BASE_PATH } = await loadModule();
    expect(BASE_PATH).toBe("/some/prefix/");
  });

  it("strips the trailing filename from a non-slash window.location.pathname fallback", async () => {
    // Deep link like ``/some/prefix/device/abc`` with no script
    // signal — the helper has to assume the last segment is a route
    // and trim it. Imperfect but matches what we can know without
    // the bundle's own URL.
    setGlobals({ pathname: "/some/prefix/device/abc" });
    const { BASE_PATH } = await loadModule();
    expect(BASE_PATH).toBe("/some/prefix/device/");
  });
});

describe("withBase", () => {
  it("is a no-op for root-mounted deployments", async () => {
    setGlobals({ scriptSrc: "https://example.com/app.js" });
    const { withBase } = await loadModule();
    expect(withBase("/")).toBe("/");
    expect(withBase("/dashboard")).toBe("/dashboard");
    expect(withBase("/device/abc")).toBe("/device/abc");
  });

  it("prefixes absolute paths with the deployment base", async () => {
    setGlobals({ scriptSrc: "https://example.com/api/hassio_ingress/T/app.js" });
    const { withBase } = await loadModule();
    expect(withBase("/")).toBe("/api/hassio_ingress/T/");
    expect(withBase("/dashboard")).toBe("/api/hassio_ingress/T/dashboard");
    expect(withBase("/assets/logo/esphome.svg")).toBe(
      "/api/hassio_ingress/T/assets/logo/esphome.svg"
    );
  });

  it("passes relative paths through unchanged", async () => {
    setGlobals({ scriptSrc: "https://example.com/some/prefix/app.js" });
    const { withBase } = await loadModule();
    expect(withBase("dashboard")).toBe("dashboard");
    expect(withBase("./assets/foo.png")).toBe("./assets/foo.png");
    expect(withBase("")).toBe("");
  });
});

describe("stripBase", () => {
  it("is a no-op for root-mounted deployments", async () => {
    setGlobals({ scriptSrc: "https://example.com/app.js" });
    const { stripBase } = await loadModule();
    expect(stripBase("/")).toBe("/");
    expect(stripBase("/dashboard")).toBe("/dashboard");
    expect(stripBase("/device/abc")).toBe("/device/abc");
  });

  it("strips the deployment base from a prefixed pathname", async () => {
    setGlobals({ scriptSrc: "https://example.com/some/prefix/app.js" });
    const { stripBase } = await loadModule();
    expect(stripBase("/some/prefix/")).toBe("/");
    expect(stripBase("/some/prefix/dashboard")).toBe("/dashboard");
    expect(stripBase("/some/prefix/device/abc")).toBe("/device/abc");
  });

  it("returns '/' when pathname equals the base without a trailing slash", async () => {
    // Browser back / direct hit at the bare mount point — the path
    // can be either ``/foo`` or ``/foo/`` depending on the redirect
    // story; both should map to the app's "/" route.
    setGlobals({ scriptSrc: "https://example.com/foo/app.js" });
    const { stripBase } = await loadModule();
    expect(stripBase("/foo")).toBe("/");
    expect(stripBase("/foo/")).toBe("/");
  });

  it("does NOT strip from a pathname that merely shares a leading prefix", async () => {
    // Regression for the Copilot-flagged boundary bug: ``startsWith``
    // alone would have stripped ``/foo`` from ``/foobar/...``,
    // breaking back-button comparisons on any deployment whose
    // sibling routes happened to share a name prefix with the mount.
    setGlobals({ scriptSrc: "https://example.com/foo/app.js" });
    const { stripBase } = await loadModule();
    expect(stripBase("/foobar")).toBe("/foobar");
    expect(stripBase("/foobar/baz")).toBe("/foobar/baz");
    expect(stripBase("/food")).toBe("/food");
  });

  it("returns the original pathname when there is no overlap with the base", async () => {
    setGlobals({ scriptSrc: "https://example.com/some/prefix/app.js" });
    const { stripBase } = await loadModule();
    expect(stripBase("/other")).toBe("/other");
    expect(stripBase("/")).toBe("/");
  });
});
