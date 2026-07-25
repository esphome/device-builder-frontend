/**
 * @vitest-environment happy-dom
 *
 * Pins the component editor's delete path against mid-round-trip
 * navigation: an unmounted element's yaml-updated still reaches the
 * page through the mount-time ShadowRoot anchor (composed included),
 * and section-select never fires at a user who left the deleted
 * section — by unmount or by same-kind element reuse.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import "../../_mock-webawesome.js";

import { ESPHomeDeviceSectionConfig } from "../../../src/components/device/device-section-config.js";
import { onDeleteConfirmed } from "../../../src/components/device/device-section-config/draft-and-delete.js";

const ROW_YAML = [
  "binary_sensor:",
  "  - platform: gpio",
  "    id: btn",
  "    on_press:",
  "      - logger.log: hi",
].join("\n");

/* eslint-disable @typescript-eslint/no-explicit-any */

function makeHost() {
  const c = new ESPHomeDeviceSectionConfig();
  const inner = c as any;
  inner.yaml = "wifi:\n  ssid: home\nlogger:\n";
  inner.sectionKey = "wifi";
  inner.fromLine = 1;
  inner.configuration = "device.yaml";
  inner._config = { title: "WiFi", entries: [] };
  let resolveWrite!: () => void;
  inner._api = {
    updateConfig: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        })
    ),
  };
  return { c, inner, release: () => resolveWrite() };
}

describe("onDeleteConfirmed mid-round-trip navigation", () => {
  it("unmounted mid-flight: lands yaml-updated through the ShadowRoot anchor, no section-select", async () => {
    const { c, release } = makeHost();
    // Production's anchor is board-info's ShadowRoot; the listener on
    // the shadow host pins that the fallback dispatch crosses the
    // boundary (composed), not merely that the target swapped.
    const outer = document.createElement("div");
    const shadow = outer.attachShadow({ mode: "open" });
    shadow.appendChild(c);
    document.body.appendChild(outer);
    const updates: string[] = [];
    outer.addEventListener("yaml-updated", (e) =>
      updates.push((e as CustomEvent<{ yaml: string }>).detail.yaml)
    );
    const selections: unknown[] = [];
    outer.addEventListener("section-select", (e) => selections.push(e));

    try {
      // The element is connected when the delete starts — the anchor
      // snapshot must be taken here, before the unmount.
      const deleting = onDeleteConfirmed(c);
      c.remove();
      release();
      await deleting;

      expect(updates).toEqual(["logger:\n"]);
      expect(selections).toHaveLength(0);
    } finally {
      outer.remove();
    }
  });

  it("row delete unmounted mid-flight still lands yaml-updated through the anchor", async () => {
    const c = new ESPHomeDeviceSectionConfig();
    const inner = c as any;
    inner.yaml = ROW_YAML;
    inner.sectionKey = "binary_sensor.gpio";
    inner.fromLine = 2;
    inner.configuration = "device.yaml";
    let resolveWrite!: () => void;
    inner._api = {
      deleteAutomation: vi
        .fn()
        .mockResolvedValue({ yaml_diff: { fromLine: 4, toLine: 5, replacement: "" } }),
      updateConfig: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveWrite = resolve;
          })
      ),
    };
    const outer = document.createElement("div");
    const shadow = outer.attachShadow({ mode: "open" });
    shadow.appendChild(c);
    document.body.appendChild(outer);
    const updates: string[] = [];
    outer.addEventListener("yaml-updated", (e) =>
      updates.push((e as CustomEvent<{ yaml: string }>).detail.yaml)
    );

    try {
      const deleting = inner._onDeleteRow(
        new CustomEvent("delete-row", {
          detail: { key: "automation:component_on:btn:on_press" },
        })
      );
      // The user switches to a different-kind section mid round trip.
      c.remove();
      // Let the delete reach the deferred updateConfig before releasing.
      await new Promise((r) => setTimeout(r));
      resolveWrite();
      await deleting;

      expect(updates).toHaveLength(1);
      expect(updates[0]).not.toContain("on_press");
    } finally {
      outer.remove();
    }
  });

  it("same-kind reuse: a retargeted but still-connected element does not navigate away", async () => {
    const { c, inner, release } = makeHost();
    const container = document.createElement("div");
    container.appendChild(c);
    document.body.appendChild(container);
    const updates: string[] = [];
    container.addEventListener("yaml-updated", (e) =>
      updates.push((e as CustomEvent<{ yaml: string }>).detail.yaml)
    );
    const selections: unknown[] = [];
    container.addEventListener("section-select", (e) => selections.push(e));

    try {
      const deleting = onDeleteConfirmed(c);
      // Lit reuses this element across same-kind switches: the user
      // opens logger while wifi's delete is still in flight.
      inner.sectionKey = "logger";
      release();
      await deleting;

      expect(updates).toEqual(["logger:\n"]);
      // isConnected is true here — only the deletedKey snapshot
      // stops the navigation.
      expect(selections).toHaveLength(0);
    } finally {
      container.remove();
    }
  });
});
