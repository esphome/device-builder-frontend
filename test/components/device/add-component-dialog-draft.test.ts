/**
 * @vitest-environment happy-dom
 *
 * The add-component wizard must merge into the editor's unsaved draft
 * and surface the result as a draft (so unsaved edits survive and the
 * user saves explicitly), not as a saved update. Regression for #1146.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("../../../src/components/device/add-component-form.js", () => ({}));
vi.mock("../../../src/components/device/component-catalog.js", () => ({}));

import { ESPHomeAddComponentDialog } from "../../../src/components/device/add-component-dialog.js";

describe("add-component-dialog preserves the editor draft (#1146)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("merges into this.yaml and dispatches yaml-draft, not yaml-updated", async () => {
    const dialog = new ESPHomeAddComponentDialog();
    const addComponent = vi.fn().mockResolvedValue({ yaml: "MERGED" });
    // `_returnTo` truthy drives the restore branch, which doesn't touch
    // the wa-dialog query — keeps this a pure logic test, no render.
    Object.assign(dialog as unknown as Record<string, unknown>, {
      _api: { addComponent },
      _selected: { id: "i2c" },
      _returnTo: { id: "orig" },
      _depDomain: null,
    });
    dialog.configuration = "foo.yaml";
    dialog.yaml = "esphome:\n  name: foo\n";

    const seen: Array<{ type: string; yaml: string }> = [];
    const record = (e: Event) =>
      seen.push({ type: e.type, yaml: (e as CustomEvent).detail.yaml });
    dialog.addEventListener("yaml-draft", record);
    dialog.addEventListener("yaml-updated", record);

    await (
      dialog as unknown as { _onFormSubmit: (e: CustomEvent) => Promise<void> }
    )._onFormSubmit(
      new CustomEvent("form-submit", { detail: { fields: { sda: "GPIO21" } } })
    );

    // The live draft is the merge base passed to the backend.
    expect(addComponent).toHaveBeenCalledWith(
      "foo.yaml",
      { component_id: "i2c", fields: { sda: "GPIO21" } },
      "esphome:\n  name: foo\n"
    );
    // Surfaced as an unsaved draft only.
    expect(seen).toEqual([{ type: "yaml-draft", yaml: "MERGED" }]);
  });

  it("omits the draft when the editor yaml hasn't loaded, so it isn't merged into ''", async () => {
    const dialog = new ESPHomeAddComponentDialog();
    const addComponent = vi.fn().mockResolvedValue({ yaml: "MERGED" });
    Object.assign(dialog as unknown as Record<string, unknown>, {
      _api: { addComponent },
      _selected: { id: "i2c" },
      _returnTo: { id: "orig" },
      _depDomain: null,
    });
    dialog.configuration = "foo.yaml";
    dialog.yaml = ""; // still loading — must not become the merge base

    await (
      dialog as unknown as { _onFormSubmit: (e: CustomEvent) => Promise<void> }
    )._onFormSubmit(new CustomEvent("form-submit", { detail: { fields: {} } }));

    // Third arg is undefined → backend falls back to the on-disk YAML.
    expect(addComponent).toHaveBeenCalledWith(
      "foo.yaml",
      { component_id: "i2c", fields: {} },
      undefined
    );
  });

  it("configless direct-add still merges the draft and closes the dialog", async () => {
    const dialog = new ESPHomeAddComponentDialog();
    const addComponent = vi.fn().mockResolvedValue({ yaml: "MERGED" });
    // No `_returnTo` / bundle state → the navigate-and-close branch runs,
    // exercising the draft-merge of the direct-add path through
    // `_submitComponent`. `notify` defaults false so this stays a pure
    // logic test (the toast is covered in -configless.test.ts).
    Object.assign(dialog as unknown as Record<string, unknown>, {
      _api: { addComponent },
      _selected: { id: "async_tcp", name: "Async TCP" },
      _open: true,
    });
    dialog.configuration = "foo.yaml";
    dialog.yaml = "esphome:\n  name: foo\n";

    const seen: Array<{ type: string }> = [];
    dialog.addEventListener("yaml-draft", (e) => seen.push({ type: e.type }));

    await (
      dialog as unknown as {
        _submitComponent: (
          fields: Record<string, unknown>,
          notify?: boolean
        ) => Promise<void>;
      }
    )._submitComponent({});

    expect(addComponent).toHaveBeenCalledWith(
      "foo.yaml",
      { component_id: "async_tcp", fields: {} },
      "esphome:\n  name: foo\n"
    );
    expect(seen).toEqual([{ type: "yaml-draft" }]);
    // Navigate-and-close branch ran: dialog closed, selection cleared.
    expect((dialog as unknown as { _open: boolean })._open).toBe(false);
    expect((dialog as unknown as { _selected: unknown })._selected).toBeNull();
  });
});
