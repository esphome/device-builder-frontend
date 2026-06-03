/**
 * @vitest-environment happy-dom
 *
 * A component with no config entries (e.g. Async TCP) has nothing to
 * configure — the form view would be an empty dead-end. Picking one
 * must skip the form, add it directly with an empty payload, toast,
 * and close the dialog. Components that DO have options still open the
 * form.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("../../../src/components/device/add-component-form.js", () => ({}));
vi.mock("../../../src/components/device/component-catalog.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import toast from "sonner-js";

import { ESPHomeAddComponentDialog } from "../../../src/components/device/add-component-dialog.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

/** Dialog whose API hydrates to `entry` and records `addComponent` calls. */
function makeDialog(entry: ReturnType<typeof makeComponentEntry>) {
  const addComponent = vi.fn().mockResolvedValue({ yaml: "MERGED" });
  const getComponentBodies = vi.fn().mockResolvedValue({ [entry.id]: entry });
  const dialog = new ESPHomeAddComponentDialog();
  Object.assign(dialog as unknown as Record<string, unknown>, {
    _api: { addComponent, getComponentBodies },
    _open: true,
  });
  dialog.configuration = "foo.yaml";
  dialog.yaml = "esphome:\n  name: foo\n";
  return { dialog, addComponent };
}

function select(dialog: ESPHomeAddComponentDialog, id: string) {
  return (
    dialog as unknown as {
      _onComponentSelected: (e: CustomEvent) => Promise<void>;
    }
  )._onComponentSelected(
    new CustomEvent("add-component", { detail: { component: { id } } })
  );
}

describe("add-component-dialog skips the form for configless components", () => {
  afterEach(() => {
    _clearComponentCache();
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("adds a configless component directly, toasts, and closes", async () => {
    const entry = makeComponentEntry("async_tcp", {
      name: "Async TCP",
      config_entries: [],
    });
    const { dialog, addComponent } = makeDialog(entry);

    await select(dialog, "async_tcp");

    expect(addComponent).toHaveBeenCalledWith(
      "foo.yaml",
      { component_id: "async_tcp", fields: {} },
      "esphome:\n  name: foo\n"
    );
    expect(toast.success).toHaveBeenCalledWith("device.component_added", {
      richColors: true,
    });
    // Form view never opened: dialog closed, selection cleared.
    expect((dialog as unknown as { _open: boolean })._open).toBe(false);
    expect((dialog as unknown as { _selected: unknown })._selected).toBeNull();
  });

  it("opens the form (no direct add) when the component has options", async () => {
    const entry = makeComponentEntry("wifi", {
      name: "WiFi",
      config_entries: [makeConfigEntry({ key: "ssid" })],
    });
    const { dialog, addComponent } = makeDialog(entry);

    await select(dialog, "wifi");

    expect(addComponent).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    // Form view: the entry is selected, dialog stays open.
    expect((dialog as unknown as { _selected: unknown })._selected).toBe(entry);
    expect((dialog as unknown as { _open: boolean })._open).toBe(true);
  });

  it("opens the form for a configless component with a missing dependency", async () => {
    // `captive_portal` has no options but requires `wifi`; with no wifi
    // in the yaml the form's deps banner must guide the user, so we must
    // not fast-path past it.
    const entry = makeComponentEntry("captive_portal", {
      name: "Captive Portal",
      config_entries: [],
      dependencies: ["wifi"],
    });
    const { dialog, addComponent } = makeDialog(entry);

    await select(dialog, "captive_portal");

    expect(addComponent).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect((dialog as unknown as { _selected: unknown })._selected).toBe(entry);
    expect((dialog as unknown as { _open: boolean })._open).toBe(true);
  });

  it("fast-paths a configless component once its dependency is present", async () => {
    const entry = makeComponentEntry("captive_portal", {
      name: "Captive Portal",
      config_entries: [],
      dependencies: ["wifi"],
    });
    const { dialog, addComponent } = makeDialog(entry);
    dialog.yaml = "wifi:\n  ssid: foo\n";

    await select(dialog, "captive_portal");

    expect(addComponent).toHaveBeenCalledWith(
      "foo.yaml",
      { component_id: "captive_portal", fields: {} },
      "wifi:\n  ssid: foo\n"
    );
    expect((dialog as unknown as { _open: boolean })._open).toBe(false);
  });

  it("toasts the error and keeps the dialog open when a configless add fails", async () => {
    const entry = makeComponentEntry("async_tcp", {
      name: "Async TCP",
      config_entries: [],
    });
    const { dialog, addComponent } = makeDialog(entry);
    addComponent.mockRejectedValueOnce(new Error("boom"));

    await select(dialog, "async_tcp");

    // Failure is surfaced as a toast (the empty form view would hide it),
    // and the dialog stays open as a recovery surface.
    expect(toast.error).toHaveBeenCalledWith("boom", { richColors: true });
    expect(toast.success).not.toHaveBeenCalled();
    expect((dialog as unknown as { _open: boolean })._open).toBe(true);
  });
});
