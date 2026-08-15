/**
 * @vitest-environment happy-dom
 *
 * The drawer's migration badge reads the raw migration_available flag,
 * agreeing with the dashboard dot.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../../src/components/labels/device-labels-editor.js", () => ({}));

import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { mountDrawerContent } from "./_drawer-content.js";

describe("drawer migration badge", () => {
  it("is a labeled button that opens the editor with the device", async () => {
    const device = makeConfiguredDevice({ migration_available: true });
    const { el } = await mountDrawerContent(device);
    const badge = el.shadowRoot!.querySelector<HTMLButtonElement>(
      "button.status-badge--migration"
    );
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("dashboard.status_migration_available");
    let detail: unknown;
    el.addEventListener("open-config-migration", (e) => {
      detail = (e as CustomEvent).detail;
    });
    badge!.click();
    expect(detail).toBe(device);
  });

  it("stays absent by default", async () => {
    const { el } = await mountDrawerContent();
    expect(el.shadowRoot!.querySelector(".status-badge--migration")).toBeNull();
  });
});
