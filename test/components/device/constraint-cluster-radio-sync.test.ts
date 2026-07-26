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
  it("a failing group's sync neither blocks its siblings nor escapes unhandled", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const rejecting = vi.fn(() => Promise.reject(new Error("not ready")));
      // The declared type is void | Promise<void>, so a synchronous
      // throw is the other failure shape the loop must tolerate.
      const throwing = vi.fn(() => {
        throw new Error("sync throw");
      });
      const healthy = vi.fn(() => {});
      const host = makeHost([
        radioGroup(rejecting),
        radioGroup(throwing),
        radioGroup(healthy),
      ]);
      const controller = new ConstraintClusterController(
        host as unknown as ConstructorParameters<typeof ConstraintClusterController>[0]
      );

      controller.hostUpdated();
      await settle();

      expect(rejecting).toHaveBeenCalledTimes(1);
      expect(throwing).toHaveBeenCalledTimes(1);
      expect(healthy).toHaveBeenCalledTimes(1);
      expect(consoleWarn).toHaveBeenCalledTimes(2);
      expect(consoleWarn).toHaveBeenCalledWith(
        "Radio group sync failed:",
        expect.any(Error)
      );
    } finally {
      consoleWarn.mockRestore();
    }
  });
});
