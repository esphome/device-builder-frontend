/**
 * @vitest-environment happy-dom
 *
 * Package references use the same collapsible section, row, and action
 * patterns as the other device navigator sections.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/components/device/add-automation-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-component-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-config-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-package-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-script-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeDeviceNavigator } from "../../../src/components/device/device-navigator.js";

async function mountNavigator(): Promise<ESPHomeDeviceNavigator> {
  const nav = new ESPHomeDeviceNavigator();
  nav.yaml = "esphome:\n  name: bktest\n";
  nav.configuration = "parking_helper.yaml";
  nav.packageRefs = ["packages/base.yaml", "modules/wifi.yaml"];
  document.body.appendChild(nav);
  await nav.updateComplete;
  return nav;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("device navigator package section UI", () => {
  it("uses the shared section, item-row, and add-action styles", async () => {
    const nav = await mountNavigator();
    const header = nav.shadowRoot!.querySelector<HTMLElement>(
      ".nav-content.package-section"
    )!;

    expect(header.getAttribute("role")).toBe("button");
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(header.querySelector(".nav-content-chevron")).not.toBeNull();

    const rows = nav.shadowRoot!.querySelectorAll(".nav-item");
    expect(
      [...rows].map((row) =>
        row.querySelector(".nav-item-content p")?.textContent?.trim()
      )
    ).toEqual(["packages/base.yaml", "modules/wifi.yaml"]);
    expect(rows[0].querySelector(".nav-item-icon")).not.toBeNull();
    expect(rows[0].querySelector(".nav-item-chevron")).not.toBeNull();
    const action = nav.shadowRoot!.querySelector<HTMLElement>(".action-item")!;
    expect(action.textContent).toContain("device.add_config");
    expect(
      rows[rows.length - 1].compareDocumentPosition(action) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("collapses and expands with the same keyboard-operable header", async () => {
    const nav = await mountNavigator();
    const header = nav.shadowRoot!.querySelector<HTMLElement>(
      ".nav-content.package-section"
    )!;

    header.click();
    await nav.updateComplete;
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(nav.shadowRoot!.querySelectorAll(".nav-item")).toHaveLength(0);

    header.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await nav.updateComplete;
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(nav.shadowRoot!.querySelectorAll(".nav-item")).toHaveLength(2);
  });

  it("opens the selected package and keeps the add action wired", async () => {
    const nav = await mountNavigator();
    const opened = vi.fn();
    const openDialog = vi.fn();
    nav.addEventListener("package-open", opened);
    Object.defineProperty(
      nav.shadowRoot!.querySelector("esphome-add-package-dialog")!,
      "open",
      { value: openDialog }
    );

    nav.shadowRoot!.querySelector<HTMLElement>(".nav-item")!.click();
    nav.shadowRoot!.querySelector<HTMLElement>(".action-item")!.click();

    expect(opened).toHaveBeenCalledOnce();
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({
      path: "packages/base.yaml",
      configuration: "parking_helper.yaml",
    });
    expect(openDialog).toHaveBeenCalledOnce();
  });
});
