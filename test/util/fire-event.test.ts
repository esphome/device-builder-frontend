import { describe, expect, it } from "vitest";
import { fireEvent } from "../../src/util/fire-event.js";

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
