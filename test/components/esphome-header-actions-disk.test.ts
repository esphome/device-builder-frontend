/**
 * @vitest-environment happy-dom
 *
 * Low free disk space badges the kebab and sends Settings to Storage.
 */
import { describe, expect, it, vi } from "vitest";

import type { DiskUsage } from "../../src/api/types/system.js";
import { renderOpenHeaderMenu } from "./_esphome-header-actions-helpers.js";

const GB = 1024 ** 3;

const usage = (free: number): DiskUsage => ({
  total_bytes: 100 * GB,
  free_bytes: free * GB,
  builds_bytes: 0,
  remote_builds_bytes: 0,
  toolchains_bytes: 0,
  cache_bytes: 0,
  config_bytes: 0,
  measured_at: 1,
});

const settingsItem = (el: HTMLElement) =>
  Array.from(el.shadowRoot!.querySelectorAll<HTMLElement>(".menu-item")).find((i) =>
    i.textContent?.includes("layout.settings")
  )!;

async function openMenu(free: number) {
  const el = await renderOpenHeaderMenu({ _localize: (k) => k, _diskUsage: usage(free) });
  const seen = vi.fn();
  el.addEventListener("open-settings", (e) => seen((e as CustomEvent).detail));
  return { el, seen };
}

describe("header-actions low disk space", () => {
  it("badges the kebab, flags Settings and opens the Storage section", async () => {
    const { el, seen } = await openMenu(3);
    expect(el.shadowRoot!.querySelector(".menu-btn-badge")).not.toBeNull();
    expect(settingsItem(el).querySelector(".menu-item-warning")).not.toBeNull();
    settingsItem(el).click();
    expect(seen).toHaveBeenCalledWith({ section: "storage" });
  });

  it("stays quiet and opens Settings as usual with enough space", async () => {
    const { el, seen } = await openMenu(50);
    expect(el.shadowRoot!.querySelector(".menu-btn-badge")).toBeNull();
    expect(settingsItem(el).querySelector(".menu-item-warning")).toBeNull();
    settingsItem(el).click();
    expect(seen).toHaveBeenCalledWith(null);
  });
});
