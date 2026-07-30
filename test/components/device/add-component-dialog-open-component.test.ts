/**
 * @vitest-environment happy-dom
 *
 * Pins `openComponent(id)`: an input-free component is added
 * immediately (toast, dialog closed), a form-bearing one lands on its
 * form, and a hydrate miss surfaces the load-failed banner.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../_mock-webawesome.js";

vi.mock("../../../src/components/device/add-component-form.js", () => ({}));
vi.mock("../../../src/components/device/component-catalog.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import toast from "sonner-js";

import { ESPHomeAddComponentDialog } from "../../../src/components/device/add-component-dialog.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

/** Dialog whose API hydrates to `entry` and records `addComponent` calls. */
function makeDialog(entry: ReturnType<typeof makeComponentEntry> | null) {
  const addComponent = vi.fn().mockResolvedValue({ yaml: "MERGED" });
  const getComponentBodies = vi
    .fn()
    .mockResolvedValue(entry ? { [entry.id]: entry } : {});
  const dialog = new ESPHomeAddComponentDialog();
  Object.assign(dialog as unknown as Record<string, unknown>, {
    _api: { addComponent, getComponentBodies },
  });
  dialog.configuration = "foo.yaml";
  dialog.yaml = "esphome:\n  name: foo\n";
  return { dialog, addComponent };
}

const dialogOpen = (dialog: ESPHomeAddComponentDialog) =>
  (dialog as unknown as { _dialog: { open: boolean } })._dialog.open;

describe("add-component-dialog openComponent", () => {
  afterEach(() => {
    _clearComponentCache();
    vi.clearAllMocks();
  });

  it("adds an input-free component immediately, toasts, and closes", async () => {
    const entry = makeComponentEntry("async_tcp", {
      name: "Async TCP",
      config_entries: [],
    });
    const { dialog, addComponent } = makeDialog(entry);

    await dialog.openComponent("async_tcp");

    expect(addComponent).toHaveBeenCalledWith(
      "foo.yaml",
      { component_id: "async_tcp", fields: {} },
      "esphome:\n  name: foo\n"
    );
    expect(toast.success).toHaveBeenCalledWith("device.component_added", {
      richColors: true,
    });
    expect(dialogOpen(dialog)).toBe(false);
  });

  it("opens onto the form when the component needs input", async () => {
    const entry = makeComponentEntry("wifi", {
      name: "WiFi",
      config_entries: [makeConfigEntry({ key: "ssid", required: true })],
    });
    const { dialog, addComponent } = makeDialog(entry);

    await dialog.openComponent("wifi");

    expect(addComponent).not.toHaveBeenCalled();
    expect((dialog as unknown as { _selected: unknown })._selected).toBe(entry);
    expect(dialogOpen(dialog)).toBe(true);
  });

  it("surfaces the load-failed banner on a hydrate miss", async () => {
    const { dialog, addComponent } = makeDialog(null);

    await dialog.openComponent("ghost");

    expect(addComponent).not.toHaveBeenCalled();
    expect((dialog as unknown as { _submitError: string })._submitError).toBe(
      "device.add_component_load_failed"
    );
    expect(dialogOpen(dialog)).toBe(true);
  });
});
