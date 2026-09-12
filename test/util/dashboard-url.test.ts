/**
 * The dashboard filter state round-trips through the URL as
 * ``encodeURIComponent``-encoded, comma-joined lists. ``encodeURIComponent``
 * escapes a comma to ``%2C``, so the ``,`` separator is unambiguous even
 * for a label/filter value that itself contains a comma — this pins that
 * invariant so a future switch to a non-encoding join would fail loudly
 * (audit #650).
 */

import { afterEach, describe, expect, it } from "vitest";
import { readDashboardUrl, writeDashboardUrl } from "../../src/util/dashboard-url.js";

type Globals = Record<string, unknown>;

// Back the stubbed ``window.location`` / ``history`` with a single mutable
// href so ``writeDashboardUrl``'s ``replaceState`` is visible to a
// following ``readDashboardUrl``.
let href = "";
function installUrl(initial = "http://localhost/dashboard"): void {
  href = initial;
  const g = globalThis as Globals;
  g.window = {
    location: {
      get href() {
        return href;
      },
      get search() {
        return new URL(href).search;
      },
    },
  };
  g.history = {
    state: null,
    replaceState: (_s: unknown, _t: string, next: string) => {
      href = new URL(next, href).href;
    },
  };
}

afterEach(() => {
  const g = globalThis as Globals;
  delete g.window;
  delete g.history;
});

describe("dashboard-url comma round-trip", () => {
  it("preserves a comma inside a label value", () => {
    installUrl();
    writeDashboardUrl({ labels: ["a,b", "c"] });
    expect(readDashboardUrl().labels).toEqual(["a,b", "c"]);
  });

  it("round-trips the project and network facets", () => {
    installUrl();
    writeDashboardUrl({
      projects: ["dcoulson.ble-rrn00-wroom06", "apollo.plt-1"],
      networks: ["wifi", "ethernet"],
    });
    const back = readDashboardUrl();
    expect(back.projects).toEqual(["dcoulson.ble-rrn00-wroom06", "apollo.plt-1"]);
    expect(back.networks).toEqual(["wifi", "ethernet"]);
  });

  it("omits both params when nothing is selected", () => {
    installUrl();
    writeDashboardUrl({ projects: [], networks: [] });
    const back = readDashboardUrl();
    expect(back.projects).toBeUndefined();
    expect(back.networks).toBeUndefined();
  });

  it("round-trips multiple filter lists", () => {
    installUrl();
    writeDashboardUrl({ labels: ["x,y"], areas: ["Kitchen, Bath"], search: "q,r" });
    const back = readDashboardUrl();
    expect(back.labels).toEqual(["x,y"]);
    expect(back.areas).toEqual(["Kitchen, Bath"]);
    expect(back.search).toBe("q,r");
  });
});
