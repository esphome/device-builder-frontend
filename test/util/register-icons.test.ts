import { beforeAll, describe, expect, test, vi } from "vitest";

// Capture the resolver handed to webawesome's icon-library registry so we
// can drive it directly — registering the resolver is the only observable
// output of ``registerMdiIcons`` (it returns void and mutates a wa-icon
// library side table).
const { registerIconLibrary } = vi.hoisted(() => ({
  registerIconLibrary: vi.fn(),
}));
vi.mock("@home-assistant/webawesome/dist/components/icon/library.js", () => ({
  registerIconLibrary,
}));

import { mdiIconSrc, registerMdiIcons } from "../../src/util/register-icons.js";

type Resolver = (name: string) => string;

/** Decode a ``data:image/svg+xml,...`` URI back to its SVG markup. */
function decode(dataUri: string): string {
  const prefix = "data:image/svg+xml,";
  expect(dataUri.startsWith(prefix)).toBe(true);
  return decodeURIComponent(dataUri.slice(prefix.length));
}

// Throwaway MDI-style path strings; their values are opaque to the helpers,
// they just get interpolated into the SVG ``d`` attribute.
const HOME = "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z";
const SQUARE = "M3 3h18v18H3z";

describe("mdiIconSrc", () => {
  test("wraps a path in an inline SVG data URI", () => {
    const svg = decode(mdiIconSrc(HOME));
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('fill="currentColor"');
    expect(svg).toContain(`d="${HOME}"`);
  });

  test("percent-encodes the markup so it survives as a URI", () => {
    const src = mdiIconSrc(HOME);
    // The raw SVG contains ``<``, ``"`` and spaces — none may appear
    // literally in a well-formed data URI, and the ``<svg`` opener must
    // come through escaped.
    expect(src).not.toContain("<");
    expect(src).not.toContain('"');
    expect(src).not.toContain(" ");
    expect(src).toContain("%3Csvg");
  });
});

describe("registerMdiIcons", () => {
  // The module keeps a single process-wide ``registered`` guard and shared
  // icon map. Trigger the one-and-only registration here and reuse the
  // captured resolver across every assertion below.
  let resolver: Resolver;

  beforeAll(() => {
    registerMdiIcons({ home: HOME });
    const call = registerIconLibrary.mock.calls[0];
    expect(call).toBeDefined();
    expect(call![0]).toBe("mdi");
    resolver = (call![1] as { resolver: Resolver }).resolver;
  });

  test("resolves a registered icon name to its data URI", () => {
    expect(resolver("home")).toBe(mdiIconSrc(HOME));
  });

  test("returns an empty string and warns for an unknown name", () => {
    // Restore the spy locally rather than in an ``afterEach`` so the
    // once-guard assertion below stays decoupled from how vitest treats the
    // hoisted ``registerIconLibrary`` mock's call history.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(resolver("does-not-exist")).toBe("");
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]!.join(" ")).toContain("does-not-exist");
    } finally {
      warn.mockRestore();
    }
  });

  test("registers the library exactly once across repeated calls", () => {
    registerMdiIcons({ square: SQUARE });
    registerMdiIcons({ another: HOME });
    // The ``registered`` guard means the registry only ever sees one ``mdi``
    // library; later calls just extend the shared map.
    expect(registerIconLibrary).toHaveBeenCalledTimes(1);
  });

  test("a later call extends the same map the captured resolver reads", () => {
    // ``late`` is unknown until registered after the resolver closed over
    // the map, yet the resolver reads the live shared map, so once added it
    // resolves all the same.
    expect(resolver("late")).toBe("");
    registerMdiIcons({ late: SQUARE });
    expect(resolver("late")).toBe(mdiIconSrc(SQUARE));
  });
});
