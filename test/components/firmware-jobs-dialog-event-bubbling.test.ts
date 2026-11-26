/**
 * @vitest-environment happy-dom
 *
 * The jobs dialog lives inside the layout so its nested dialogs' open-*
 * events reach the layout listeners. Pins that open-reset-build-env escapes
 * the dialog untouched, and both halves of open-settings: the event keeps
 * bubbling past the dialog, and the dialog closes itself.
 */
import { describe, expect, it, vi } from "vitest";

import "../_mock-webawesome.js";
vi.mock("../../src/util/notify.js", () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));
vi.mock("../../src/util/navigation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/util/navigation.js")>()),
  navigate: vi.fn().mockResolvedValue(true),
}));

import { dialogOpen, mount } from "../_dom.js";
import { ESPHomeFirmwareJobsDialog } from "../../src/components/firmware-jobs-dialog.js";
import { navigate } from "../../src/util/navigation.js";

describe("firmware-jobs-dialog event bubbling", () => {
  it("lets open-reset-build-env escape to an ancestor", async () => {
    const seen = vi.fn();
    document.addEventListener("open-reset-build-env", seen, { once: true });
    const dialog = await mount(new ESPHomeFirmwareJobsDialog());
    dialog
      .shadowRoot!.querySelector("esphome-command-dialog")!
      .dispatchEvent(
        new CustomEvent("open-reset-build-env", { bubbles: true, composed: true })
      );
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("lets open-settings through to an ancestor and closes itself", async () => {
    const seen = vi.fn();
    const onOpenSettings = (e: Event) => seen((e as CustomEvent).detail);
    document.addEventListener("open-settings", onOpenSettings);
    try {
      const dialog = await mount(new ESPHomeFirmwareJobsDialog());
      dialog.open();
      await dialog.updateComplete;
      expect(dialogOpen(dialog)).toBe(true);

      dialog.shadowRoot!.querySelector("esphome-command-dialog")!.dispatchEvent(
        new CustomEvent("open-settings", {
          detail: { section: "build_offload" },
          bubbles: true,
          composed: true,
        })
      );

      expect(seen).toHaveBeenCalledWith({ section: "build_offload" });
      expect(dialogOpen(dialog)).toBe(false);
    } finally {
      document.removeEventListener("open-settings", onOpenSettings);
    }
  });

  it("opens a nested device's editor from request-open-editor and closes", async () => {
    const dialog = await mount(new ESPHomeFirmwareJobsDialog());
    dialog.open();
    await dialog.updateComplete;

    dialog.shadowRoot!.querySelector("esphome-command-dialog")!.dispatchEvent(
      new CustomEvent("request-open-editor", {
        detail: { configuration: "devices/lights/desk lamp.yaml" },
        bubbles: true,
        composed: true,
      })
    );

    expect(navigate).toHaveBeenCalledWith("/device/devices/lights/desk%20lamp.yaml");
    expect(dialogOpen(dialog)).toBe(false);
  });
});
