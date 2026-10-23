/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../_dom.js";
import { ESPHomeAddPackageDialog } from "../../../src/components/device/add-package-dialog.js";

const YAML_FILES = [
  "includes/common.yaml",
  "modules/wifi.yaml",
  "packages/base.yaml",
  "sensors/temperature.yml",
];

async function mount() {
  const api = { listPackages: vi.fn(async () => YAML_FILES) };
  const dialog = new ESPHomeAddPackageDialog();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dialog as any)._api = api;
  dialog.configuration = "lamp.yaml";
  document.body.append(dialog);
  await dialog.updateComplete;
  return { dialog, api };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("add package dialog", () => {
  it("offers shared YAML files from packages, modules, sensors, and other folders", async () => {
    const { dialog, api } = await mount();
    dialog.open();
    await flushMicrotasks(5);
    await dialog.updateComplete;

    const options = [...dialog.shadowRoot!.querySelectorAll("select")[1].options].map(
      (option) => option.value
    );
    expect(api.listPackages).toHaveBeenCalledOnce();
    expect(options).toEqual(["", ...YAML_FILES]);
  });

  it("keeps a selected module path when adding it to a device", async () => {
    const { dialog } = await mount();
    const selected = vi.fn();
    dialog.addEventListener("package-selected", selected);
    dialog.open();
    await flushMicrotasks(5);
    await dialog.updateComplete;

    const pathSelect = dialog.shadowRoot!.querySelectorAll("select")[1];
    pathSelect.value = "modules/wifi.yaml";
    pathSelect.dispatchEvent(new Event("change"));
    dialog
      .shadowRoot!.querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(selected).toHaveBeenCalledOnce();
    expect((selected.mock.calls[0][0] as CustomEvent).detail).toEqual({
      configuration: "lamp.yaml",
      path: "modules/wifi.yaml",
      create: false,
    });
  });
});
