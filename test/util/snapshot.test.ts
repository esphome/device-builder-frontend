import { describe, expect, it } from "vitest";

import { seededMap } from "../../src/util/snapshot.js";

describe("seededMap", () => {
  it("returns null when the input is undefined", () => {
    // absent-field semantics: snapshot omitted the field
    // entirely (controller not wired up), the consuming
    // context stays in its still-loading / not-applicable
    // state.
    expect(seededMap<{ id: string }, string>(undefined, (r) => r.id)).toBeNull();
  });

  it("returns an empty Map when the input is an empty list", () => {
    // empty-list semantics: snapshot present, no rows.
    // Distinct from undefined — the host renders the
    // loaded-but-empty UI.
    const m = seededMap<{ id: string }, string>([], (r) => r.id);
    expect(m).not.toBeNull();
    expect(m!.size).toBe(0);
  });

  it("builds a Map keyed by the keyFn", () => {
    const rows = [
      { name: "alpha", val: 1 },
      { name: "beta", val: 2 },
    ];
    const m = seededMap(rows, (r) => r.name);
    expect(m).not.toBeNull();
    expect(m!.size).toBe(2);
    expect(m!.get("alpha")).toEqual({ name: "alpha", val: 1 });
    expect(m!.get("beta")).toEqual({ name: "beta", val: 2 });
  });

  it("supports non-string keys", () => {
    const rows = [
      { port: 80, label: "http" },
      { port: 443, label: "https" },
    ];
    const m = seededMap(rows, (r) => r.port);
    expect(m!.get(443)).toEqual({ port: 443, label: "https" });
  });

  it("collides keys on duplicates (last write wins, like Map ctor)", () => {
    // Documenting the behaviour rather than guarding against
    // it — the callers in app-shell already pass arrays the
    // backend has deduped (pin_sha256 / hostname / etc.).
    // If a future caller passed an array with key collisions
    // they'd get the same last-write-wins shape ``new Map``
    // gives.
    const rows = [
      { id: "x", v: 1 },
      { id: "x", v: 2 },
    ];
    const m = seededMap(rows, (r) => r.id);
    expect(m!.size).toBe(1);
    expect(m!.get("x")).toEqual({ id: "x", v: 2 });
  });
});
