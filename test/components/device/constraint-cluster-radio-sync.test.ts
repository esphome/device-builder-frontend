/**
 * @vitest-environment happy-dom
 *
 * Pins the radio-sync pass's rejection tolerance (#1505): one
 * group's failing ``syncRadioElements`` must not abort the pass or
 * escape as an unhandled rejection — the other groups still sync
 * and the failure leaves a console trace.
 */
import { describe, expect, it, vi } from "vitest";

import { ConstraintClusterController } from "../../../src/components/device/constraint-cluster-controller.js";

function makeHost(groups: HTMLElement[]) {
  const outer = document.createElement("div");
  const shadowRoot = outer.attachShadow({ mode: "open" });
  for (const g of groups) shadowRoot.appendChild(g);
  return {
    shadowRoot,
    addController: () => {},
    removeController: () => {},
    requestUpdate: () => {},
    updateComplete: Promise.resolve(true),
  };
}

function radioGroup(sync: () => void | Promise<void>): HTMLElement {
  const el = document.createElement("wa-radio-group");
  Object.assign(el, {
    syncRadioElements: sync,
    updateComplete: Promise.resolve(true),
  });
  return el;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("constraint-cluster radio sync tolerance", () => {
  it("a rejecting group's sync neither blocks its siblings nor escapes unhandled", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const failing = vi.fn(() => Promise.reject(new Error("not ready")));
      const healthy = vi.fn(() => {});
      const host = makeHost([radioGroup(failing), radioGroup(healthy)]);
      const controller = new ConstraintClusterController(
        host as unknown as ConstructorParameters<typeof ConstraintClusterController>[0]
      );

      controller.hostUpdated();
      await settle();

      expect(failing).toHaveBeenCalledTimes(1);
      expect(healthy).toHaveBeenCalledTimes(1);
      expect(consoleWarn).toHaveBeenCalledWith(
        "Radio group sync failed:",
        expect.any(Error)
      );
    } finally {
      consoleWarn.mockRestore();
    }
  });
});
