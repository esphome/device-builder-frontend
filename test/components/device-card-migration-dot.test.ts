/**
 * @vitest-environment happy-dom
 *
 * The migration dot reads the raw migration_available flag — YAML-derived,
 * never mDNS-gated — and deep-links to the editor, where the migrate nudge
 * is the next click. Passive while selecting: the whole card is one toggle
 * target in select mode.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/tooltip/tooltip.js", () => ({}));

import { mountDeviceCard as mount } from "./_device-card.js";

describe("device-card migration dot", () => {
  it("is a button that opens the editor without triggering the card click", async () => {
    const el = await mount({ migrationAvailable: true });
    const dot = el.shadowRoot!.querySelector<HTMLButtonElement>(
      "button.indicator-dot--migration"
    );
    expect(dot).not.toBeNull();
    expect(
      el.shadowRoot!.querySelector("wa-tooltip[for='ind-migration']")?.textContent
    ).toContain("dashboard.status_migration_available_action");
    let opens = 0;
    let cardClicks = 0;
    el.addEventListener("open-config-migration", () => {
      opens++;
    });
    el.addEventListener("card-click", () => {
      cardClicks++;
    });
    dot!.click();
    expect(opens).toBe(1);
    expect(cardClicks).toBe(0);
  });

  it("renders passive while selecting", async () => {
    const el = await mount({ migrationAvailable: true, selectMode: true });
    expect(el.shadowRoot!.querySelector("button.indicator-dot--migration")).toBeNull();
    expect(el.shadowRoot!.querySelector("span.indicator-dot--migration")).not.toBeNull();
  });

  it("hides the dot by default", async () => {
    const el = await mount({});
    expect(el.shadowRoot!.querySelector(".indicator-dot--migration")).toBeNull();
  });
});
