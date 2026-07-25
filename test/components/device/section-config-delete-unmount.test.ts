/**
 * @vitest-environment happy-dom
 *
 * Pins the component editor's delete path when the element is
 * unmounted mid round trip: the disk write's yaml-updated must still
 * reach the page through the mount-time parent, and no
 * section-select navigation fires at a user who already left.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import "../../_mock-webawesome.js";

import { ESPHomeDeviceSectionConfig } from "../../../src/components/device/device-section-config.js";
import { onDeleteConfirmed } from "../../../src/components/device/device-section-config/draft-and-delete.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("onDeleteConfirmed unmounted mid round trip", () => {
  it("lands yaml-updated through the mount-time parent and skips section-select", async () => {
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

    // Detached grandparent chain: isConnected stays false (the
    // unmounted state under test), the parent carries the dispatch,
    // and the grandparent listener pins that it bubbles.
    const grandparent = document.createElement("div");
    const parent = document.createElement("div");
    grandparent.appendChild(parent);
    parent.appendChild(c);
    const updates: string[] = [];
    grandparent.addEventListener("yaml-updated", (e) =>
      updates.push((e as CustomEvent<{ yaml: string }>).detail.yaml)
    );
    const selections: unknown[] = [];
    grandparent.addEventListener("section-select", (e) => selections.push(e));

    const deleting = onDeleteConfirmed(c);
    resolveWrite();
    await deleting;

    expect(updates).toEqual(["logger:\n"]);
    expect(selections).toHaveLength(0);
  });
});
