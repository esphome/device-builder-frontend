import { describe, expect, it } from "vitest";
import { fireEvent, fireFromAnchor } from "../../src/util/fire-event.js";

describe("fireEvent", () => {
  it("dispatches a bubbling composed CustomEvent with the detail", () => {
    const target = new EventTarget();
    let seen: CustomEvent | null = null;
    target.addEventListener("chosen", (e) => {
      seen = e as CustomEvent;
    });

    fireEvent(target, "chosen", { v: 1 });

    expect(seen).not.toBeNull();
    expect(seen!.detail).toEqual({ v: 1 });
    expect(seen!.bubbles).toBe(true);
    expect(seen!.composed).toBe(true);
  });

  it("defaults detail to null when omitted", () => {
    const target = new EventTarget();
    let seen: CustomEvent | null = null;
    target.addEventListener("plain", (e) => {
      seen = e as CustomEvent;
    });

    fireEvent(target, "plain");

    expect(seen!.detail).toBeNull();
  });
});

describe("fireFromAnchor", () => {
  it("dispatches from the host while connected", () => {
    const host = new EventTarget();
    const anchor = new EventTarget();
    const seen: string[] = [];
    host.addEventListener("yaml-updated", () => seen.push("host"));
    anchor.addEventListener("yaml-updated", () => seen.push("anchor"));

    fireFromAnchor(host, true, anchor, "yaml-updated", { yaml: "x" });

    expect(seen).toEqual(["host"]);
  });

  it("dispatches from the anchor once the host is disconnected", () => {
    const host = new EventTarget();
    const anchor = new EventTarget();
    const seen: string[] = [];
    host.addEventListener("yaml-updated", () => seen.push("host"));
    anchor.addEventListener("yaml-updated", () => seen.push("anchor"));

    fireFromAnchor(host, false, anchor, "yaml-updated", { yaml: "x" });

    expect(seen).toEqual(["anchor"]);
  });

  it("silently no-ops when disconnected with no anchor", () => {
    const host = new EventTarget();
    const seen: string[] = [];
    host.addEventListener("yaml-updated", () => seen.push("host"));

    // Deliberate contract: a host that never mounted has nowhere to
    // deliver — swallow rather than throw.
    fireFromAnchor(host, false, null, "yaml-updated", { yaml: "x" });

    expect(seen).toEqual([]);
  });
});
