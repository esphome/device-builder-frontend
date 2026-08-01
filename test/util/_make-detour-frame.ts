import type { DetourFrame } from "../../src/components/device/add-component-dialog-dep-nav.js";

/** A suspended detour level; `component` is loose so seeds can pass a stub. */
export function makeDetourFrame(
  component: unknown,
  overrides: Partial<DetourFrame> = {}
): DetourFrame {
  return {
    component,
    depDomain: "spi",
    values: null,
    prefill: null,
    ...overrides,
  } as DetourFrame;
}
