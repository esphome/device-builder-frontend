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

import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
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
  });
  (dialog as unknown as { _dialog: { open: boolean } })._dialog.open = true;
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
    expect((dialog as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(
      false
    );
    expect((dialog as unknown as { _selected: unknown })._selected).toBeNull();
  });

  it("opens the form (no direct add) when the component has a required field", async () => {
    const entry = makeComponentEntry("wifi", {
      name: "WiFi",
      config_entries: [makeConfigEntry({ key: "ssid", required: true })],
    });
    const { dialog, addComponent } = makeDialog(entry);

    await select(dialog, "wifi");

    expect(addComponent).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    // Form view: the entry is selected, dialog stays open.
    expect((dialog as unknown as { _selected: unknown })._selected).toBe(entry);
    expect((dialog as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(true);
  });

  it("adds directly when the only fields are optional and non-name", async () => {
    // The add form renders required-only, so an optional non-`name` field
    // is never painted; opening the form would be the same blank dead-end,
    // so it fast-paths like an advanced-only component.
    const entry = makeComponentEntry("debug", {
      name: "Debug",
      config_entries: [makeConfigEntry({ key: "update_interval" })],
    });
    const { dialog, addComponent } = makeDialog(entry);

    await select(dialog, "debug");

    expect(addComponent).toHaveBeenCalledWith(
      "foo.yaml",
      { component_id: "debug", fields: {} },
      "esphome:\n  name: foo\n"
    );
    expect((dialog as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(
      false
    );
  });

  it("opens the form when an always-shown name field survives required-only", async () => {
    // `name` is on the always-shown allowlist, so a component with just a
    // name still paints a field — keep the form.
    const entry = makeComponentEntry("sensor.template", {
      name: "Template Sensor",
      config_entries: [makeConfigEntry({ key: "name" })],
    });
    const { dialog, addComponent } = makeDialog(entry);

    await select(dialog, "sensor.template");

    expect(addComponent).not.toHaveBeenCalled();
    expect((dialog as unknown as { _selected: unknown })._selected).toBe(entry);
    expect((dialog as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(true);
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
    expect((dialog as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(true);
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
    expect((dialog as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(
      false
    );
  });

  it("opens the form for an advanced-only exclusive group (always-shown dropdown)", async () => {
    // An exclusive_group renders as an always-shown dropdown the user must
    // choose from, outside the required-only field filter; the gate reads the
    // same render plan, so it must not fast-path past that choice.
    const entry = makeComponentEntry("chooser", {
      name: "Chooser",
      config_entries: [
        makeConfigEntry({ key: "mode_a", exclusive_group: "mode", advanced: true }),
        makeConfigEntry({ key: "mode_b", exclusive_group: "mode", advanced: true }),
      ],
    });
    const { dialog, addComponent } = makeDialog(entry);

    await select(dialog, "chooser");

    expect(addComponent).not.toHaveBeenCalled();
    expect((dialog as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(true);
  });

  it("opens the form for an advanced-only constraint cluster (always-shown box)", async () => {
    // An inclusive `group` folds into an always-shown constraint-cluster box;
    // like the exclusive case, the gate must keep the form.
    const entry = makeComponentEntry("clustered", {
      name: "Clustered",
      config_entries: [
        makeConfigEntry({ key: "a", group: "g", advanced: true }),
        makeConfigEntry({ key: "b", group: "g", advanced: true }),
      ],
    });
    const { dialog, addComponent } = makeDialog(entry);

    await select(dialog, "clustered");

    expect(addComponent).not.toHaveBeenCalled();
    expect((dialog as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(true);
  });

  it("adds an advanced-only component directly (Socket), toasts, and closes", async () => {
    // `socket` has one entry, `implementation`, marked advanced; the
    // add-form (required-only, no advanced toggle) paints nothing, so it
    // must fast-path like a configless component instead of an empty form.
    const entry = makeComponentEntry("socket", {
      name: "Socket",
      config_entries: [makeConfigEntry({ key: "implementation", advanced: true })],
    });
    const { dialog, addComponent } = makeDialog(entry);

    await select(dialog, "socket");

    expect(addComponent).toHaveBeenCalledWith(
      "foo.yaml",
      { component_id: "socket", fields: {} },
      "esphome:\n  name: foo\n"
    );
    expect(toast.success).toHaveBeenCalledWith("device.component_added", {
      richColors: true,
    });
    expect((dialog as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(
      false
    );
    expect((dialog as unknown as { _selected: unknown })._selected).toBeNull();
  });

  it("opens the form for a required advanced field with a default (seeded becomes material)", async () => {
    // The form seeds required defaults, so a required+advanced entry with a
    // default_value renders once mounted; the gate seeds too, so it must NOT
    // fast-path and drop that value.
    const entry = makeComponentEntry("thing", {
      name: "Thing",
      config_entries: [
        makeConfigEntry({
          key: "mode",
          required: true,
          advanced: true,
          default_value: "AUTO",
        }),
      ],
    });
    const { dialog, addComponent } = makeDialog(entry);

    await select(dialog, "thing");

    expect(addComponent).not.toHaveBeenCalled();
    expect((dialog as unknown as { _selected: unknown })._selected).toBe(entry);
    expect((dialog as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(true);
  });

  it("fast-paths but submits the seeded id the form would have sent (not {})", async () => {
    // The form seeds and submits an auto id even though required-only hides
    // it; the fast-path must submit the same coerced values, not `{}`.
    const entry = makeComponentEntry("widget", {
      name: "Widget",
      multi_conf: true,
      config_entries: [
        makeConfigEntry({ key: "id", type: ConfigEntryType.ID }),
        makeConfigEntry({ key: "tweak", advanced: true }),
      ],
    });
    const { dialog, addComponent } = makeDialog(entry);

    await select(dialog, "widget");

    expect(addComponent).toHaveBeenCalledWith(
      "foo.yaml",
      {
        component_id: "widget",
        fields: expect.objectContaining({ id: expect.any(String) }),
      },
      "esphome:\n  name: foo\n"
    );
    expect((dialog as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(
      false
    );
  });

  it("fast-paths an advanced-only component whose dep is satisfied by a platform stem", async () => {
    // The form's findMissingDependencies treats `sensor: platform: atm90e32`
    // as satisfying an `atm90e32` dep; the gate uses the same logic, so a
    // plain top-level-block check doesn't keep a blank form here.
    const entry = makeComponentEntry("socket", {
      name: "Socket",
      config_entries: [makeConfigEntry({ key: "implementation", advanced: true })],
      dependencies: ["atm90e32"],
    });
    const { dialog, addComponent } = makeDialog(entry);
    dialog.yaml = "sensor:\n  - platform: atm90e32\n";

    await select(dialog, "socket");

    expect(addComponent).toHaveBeenCalled();
    expect((dialog as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(
      false
    );
  });

  it("opens the form for an advanced-only component when a prefill is active", async () => {
    // A prefilled selection carries overlays/values the `{}`-seeded probe
    // can't predict, so the gate must not fast-path even when the bare
    // schema renders blank.
    const entry = makeComponentEntry("socket", {
      name: "Socket",
      config_entries: [makeConfigEntry({ key: "implementation", advanced: true })],
    });
    const { dialog, addComponent } = makeDialog(entry);
    (dialog as unknown as { _prefillReference: unknown })._prefillReference = {
      domain: "i2c",
      id: "bus_a",
    };

    await select(dialog, "socket");

    expect(addComponent).not.toHaveBeenCalled();
    expect((dialog as unknown as { _selected: unknown })._selected).toBe(entry);
    expect((dialog as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(true);
  });

  it("opens the form for an advanced-only component with a missing dependency", async () => {
    const entry = makeComponentEntry("socket", {
      name: "Socket",
      config_entries: [makeConfigEntry({ key: "implementation", advanced: true })],
      dependencies: ["network"],
    });
    const { dialog, addComponent } = makeDialog(entry);

    await select(dialog, "socket");

    expect(addComponent).not.toHaveBeenCalled();
    expect((dialog as unknown as { _selected: unknown })._selected).toBe(entry);
    expect((dialog as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(true);
  });

  it("fast-paths a featured entry but submits its from_preset values", async () => {
    // A featured id seeds its `from_preset` fields, so the preset rides in
    // the coerced payload even when the field is advanced and the form
    // paints nothing — no `{}`-drop, no need to force the form open.
    const entry = makeComponentEntry("featured.bw15.socket", {
      name: "Socket",
      config_entries: [
        makeConfigEntry({
          key: "implementation",
          advanced: true,
          default_value: "lwip",
          from_preset: true,
        }),
      ],
    });
    const { dialog, addComponent } = makeDialog(entry);

    await select(dialog, "featured.bw15.socket");

    expect(addComponent).toHaveBeenCalledWith(
      "foo.yaml",
      { component_id: "featured.bw15.socket", fields: { implementation: "lwip" } },
      "esphome:\n  name: foo\n"
    );
    expect((dialog as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(
      false
    );
  });

  it("fast-paths a featured entry that has no config entries (no presets to lose)", async () => {
    const entry = makeComponentEntry("featured.bw15.async_tcp", {
      name: "Async TCP",
      config_entries: [],
    });
    const { dialog, addComponent } = makeDialog(entry);

    await select(dialog, "featured.bw15.async_tcp");

    expect(addComponent).toHaveBeenCalledWith(
      "foo.yaml",
      { component_id: "featured.bw15.async_tcp", fields: {} },
      "esphome:\n  name: foo\n"
    );
    expect((dialog as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(
      false
    );
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
    expect((dialog as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(true);
  });
});
