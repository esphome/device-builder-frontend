/**
 * @vitest-environment happy-dom
 *
 * The migration dot reads the raw migration_available flag — YAML-derived,
 * so unlike the modified / update dots it is never mDNS-gated.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/tooltip/tooltip.js", () => ({}));

import { mountDeviceCard as mount } from "./_device-card.js";

describe("device-card migration dot", () => {
  it("shows the dot with its tooltip when migration_available is set", async () => {
    const el = await mount({ migrationAvailable: true });
    expect(el.shadowRoot!.querySelector(".indicator-dot--migration")).not.toBeNull();
    expect(
      el.shadowRoot!.querySelector("wa-tooltip[for='ind-migration']")?.textContent
    ).toContain("dashboard.status_migration_available");
  });

  it("hides the dot by default", async () => {
    const el = await mount({});
    expect(el.shadowRoot!.querySelector(".indicator-dot--migration")).toBeNull();
  });
});
