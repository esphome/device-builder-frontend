import { describe, expect, it } from "vitest";
import {
  advanceScrollGate,
  type ScrollGate,
} from "../../../src/components/device/field-scroll-controller.js";

const MAX = 3;
const A = '["a"]';
const B = '["b"]';
const fresh = (): ScrollGate => ({ tries: 0 });

describe("advanceScrollGate", () => {
  it("scrolls a new target and spends one try", () => {
    const { gate, scroll } = advanceScrollGate(fresh(), A, true, MAX);
    expect(scroll).toBe(true);
    expect(gate).toEqual({ scrolledKey: undefined, lastFocusKey: A, tries: 1 });
  });

  it("does not scroll without a relevant prop change", () => {
    expect(advanceScrollGate(fresh(), A, false, MAX).scroll).toBe(false);
  });

  it("does not re-scroll a consumed target (same key, new array ref)", () => {
    // The Copilot value-dedup fix: focusFieldPath is a fresh array each cursor
    // move, but the same logical field shouldn't re-scroll once reached.
    const consumed: ScrollGate = { scrolledKey: A, lastFocusKey: A, tries: 1 };
    const { gate, scroll } = advanceScrollGate(consumed, A, true, MAX);
    expect(scroll).toBe(false);
    expect(gate).toEqual(consumed);
  });

  it("resets the budget and re-scrolls when the target changes by value", () => {
    const consumed: ScrollGate = { scrolledKey: A, lastFocusKey: A, tries: 3 };
    const { gate, scroll } = advanceScrollGate(consumed, B, true, MAX);
    expect(scroll).toBe(true);
    expect(gate).toEqual({ scrolledKey: undefined, lastFocusKey: B, tries: 1 });
  });

  it("stops retrying after maxTries for an unresolved target", () => {
    const exhausted: ScrollGate = { lastFocusKey: A, tries: MAX };
    expect(advanceScrollGate(exhausted, A, true, MAX).scroll).toBe(false);
  });

  it("clearing the target (empty path) resets and never scrolls", () => {
    const consumed: ScrollGate = { scrolledKey: A, lastFocusKey: A, tries: 1 };
    const { gate, scroll } = advanceScrollGate(consumed, undefined, true, MAX);
    expect(scroll).toBe(false);
    expect(gate).toEqual({ scrolledKey: undefined, lastFocusKey: undefined, tries: 0 });
  });
});
