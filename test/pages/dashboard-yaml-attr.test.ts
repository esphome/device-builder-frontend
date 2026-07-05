/**
 * @vitest-environment happy-dom
 *
 * Pins that ``ESPHomePageDashboard`` reflects a ``yaml`` host
 * attribute whenever ``_yamlMode`` is active. The dashboard host
 * clips at a fixed height unless a ``[view="cards"]`` / ``[yaml]``
 * rule unlocks scrolling, so YAML search opened from table view
 * relies on this attribute to scroll instead of clipping its hits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomePageDashboard } from "../../src/pages/dashboard.js";

async function flushPending(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function mountDashboard(
  yamlMode: boolean,
  expertMode = true
): Promise<ESPHomePageDashboard> {
  const page = new ESPHomePageDashboard();
  // YAML mode is gated behind Expert Mode (a Lit context app-shell
  // provides); mounted bare, seed both consumed fields directly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._expertMode = expertMode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._yamlMode = yamlMode;
  document.body.appendChild(page);
  await page.updateComplete;
  await flushPending();
  return page;
}

describe("dashboard yaml host attribute", () => {
  // The dashboard syncs view/search state to the URL; happy-dom shares
  // window.location across a file, so a prior mount's ``yaml`` param
  // would leak back in through ``_hydrateFromUrl`` without this reset.
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
    vi.restoreAllMocks();
  });

  it("reflects the yaml attribute when mounted in YAML mode", async () => {
    const page = await mountDashboard(true);
    expect(page.hasAttribute("yaml")).toBe(true);
  });

  it("omits the yaml attribute when not in YAML mode", async () => {
    const page = await mountDashboard(false);
    expect(page.hasAttribute("yaml")).toBe(false);
  });

  it("drops YAML mode (and the attribute) when Expert Mode is off", async () => {
    const page = await mountDashboard(true, false);
    expect(page.hasAttribute("yaml")).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((page as any)._yamlMode).toBe(false);
  });

  it("toggles the attribute as _yamlMode flips", async () => {
    const page = await mountDashboard(false);
    expect(page.hasAttribute("yaml")).toBe(false);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (page as any)._yamlMode = true;
    await page.updateComplete;
    await flushPending();
    expect(page.hasAttribute("yaml")).toBe(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (page as any)._yamlMode = false;
    await page.updateComplete;
    await flushPending();
    expect(page.hasAttribute("yaml")).toBe(false);
  });
});
