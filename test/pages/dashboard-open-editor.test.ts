/**
 * @vitest-environment happy-dom
 *
 * The install / logs dialogs ask the dashboard to open a device's editor
 * via ``request-open-editor``; a nested device keeps its literal slashes.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../src/util/navigation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/util/navigation.js")>()),
  navigate: vi.fn().mockResolvedValue(true),
}));

import { ESPHomePageDashboard } from "../../src/pages/dashboard.js";
import { navigate } from "../../src/util/navigation.js";

describe("dashboard request-open-editor", () => {
  it("navigates to the nested device's editor", () => {
    const page = new ESPHomePageDashboard();

    page._onRequestOpenEditor(
      new CustomEvent("request-open-editor", {
        detail: { configuration: "devices/lights/desk lamp.yaml" },
      })
    );

    expect(navigate).toHaveBeenCalledWith("/device/devices/lights/desk%20lamp.yaml");
  });
});
