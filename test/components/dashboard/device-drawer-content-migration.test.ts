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
  it("renders with its label when migration_available is set", async () => {
    const { el } = await mountDrawerContent(
      makeConfiguredDevice({ migration_available: true })
    );
    const badge = el.shadowRoot!.querySelector(".status-badge--migration");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("dashboard.status_migration_available");
  });

  it("stays absent by default", async () => {
    const { el } = await mountDrawerContent();
    expect(el.shadowRoot!.querySelector(".status-badge--migration")).toBeNull();
  });
});
