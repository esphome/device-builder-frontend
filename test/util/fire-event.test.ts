import { describe, expect, it } from "vitest";
import {
  fireEvent,
  fireFromAnchor,
  prepareYamlWritten,
} from "../../src/util/fire-event.js";

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

describe("prepareYamlWritten", () => {
  it("captures the anchor before the awaits and carries the basis", () => {
    const anchor = new EventTarget();
    const host = Object.assign(new EventTarget(), {
      parentNode: anchor as unknown as ParentNode,
    });
    const seen: { yaml: string; basedOn?: string }[] = [];
    anchor.addEventListener("yaml-updated", (e) =>
      seen.push((e as CustomEvent<{ yaml: string; basedOn?: string }>).detail)
    );

    const announce = prepareYamlWritten(host);
    // The host unmounts mid round trip; the announcement still rides
    // the anchor captured up front and carries the write's basis.
    host.parentNode = null as unknown as ParentNode;
    announce(false, "b:\n", "a:\n");

    expect(seen).toEqual([{ yaml: "b:\n", basedOn: "a:\n" }]);
  });
});
