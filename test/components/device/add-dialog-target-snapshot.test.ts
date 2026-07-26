/**
 * @vitest-environment happy-dom
 *
 * Pins the add dialogs' pre-await target/buffer snapshot (#1479): a
 * device switch during the round trip must not retarget the draft,
 * or the page's identity guard compares new-vs-new and passes.
 */
import { describe, expect, it, vi } from "vitest";

import "../../_mock-webawesome.js";

vi.mock("../../../src/components/device/add-component-form.js", () => ({}));
vi.mock("../../../src/components/device/component-catalog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));
vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import type { YamlDiff } from "../../../src/api/types/automations.js";
import { ESPHomeAddAutomationDialog } from "../../../src/components/device/add-automation-dialog.js";
import { ESPHomeAddComponentDialog } from "../../../src/components/device/add-component-dialog.js";
import { ESPHomeAddScriptDialog } from "../../../src/components/device/add-script-dialog.js";
import type { YamlDraftDetail } from "../../../src/components/device/section-editor.js";
import { identityLocalize } from "../../_dom.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Prepends "added:" to line 1 without deleting anything. */
const DIFF: YamlDiff = { fromLine: 1, toLine: 0, replacement: "added:\n" };

const capture = (el: EventTarget) => {
  const seen: YamlDraftDetail[] = [];
  el.addEventListener("yaml-draft", (e) =>
    seen.push((e as CustomEvent<YamlDraftDetail>).detail)
  );
  return seen;
};

describe("add dialogs snapshot their target before the await", () => {
  it("add-automation keeps the pre-switch target and basis", async () => {
    const dialog = new ESPHomeAddAutomationDialog();
    const upsert = deferred<{ yaml_diff: YamlDiff }>();
    Object.assign(dialog as unknown as Record<string, unknown>, {
      _api: { upsertAutomation: vi.fn(() => upsert.promise) },
      _localize: identityLocalize,
      _kind: "interval",
      _intervalValue: "5",
    });
    dialog.configuration = "device.yaml";
    dialog.yaml = "esphome:\n";
    const seen = capture(dialog);

    const continuing = (
      dialog as unknown as { _onContinue: () => Promise<void> }
    )._onContinue();
    // The router swaps the device mid round trip.
    dialog.configuration = "other.yaml";
    dialog.yaml = "other:\n";
    upsert.resolve({ yaml_diff: DIFF });
    await continuing;

    expect(seen).toHaveLength(1);
    expect(seen[0].configuration).toBe("device.yaml");
    // The diff landed on the pre-switch buffer, not the new device's.
    expect(seen[0].yaml).toBe("added:\nesphome:\n");
  });

  it("add-script keeps the pre-switch target and basis", async () => {
    const dialog = new ESPHomeAddScriptDialog();
    const upsert = deferred<{ yaml_diff: YamlDiff }>();
    Object.assign(dialog as unknown as Record<string, unknown>, {
      _api: { upsertAutomation: vi.fn(() => upsert.promise) },
      _localize: identityLocalize,
      _id: "my_script",
    });
    dialog.configuration = "device.yaml";
    dialog.yaml = "esphome:\n";
    const seen = capture(dialog);

    const continuing = (
      dialog as unknown as { _onContinue: () => Promise<void> }
    )._onContinue();
    dialog.configuration = "other.yaml";
    dialog.yaml = "other:\n";
    upsert.resolve({ yaml_diff: DIFF });
    await continuing;

    expect(seen).toHaveLength(1);
    expect(seen[0].configuration).toBe("device.yaml");
    expect(seen[0].yaml).toBe("added:\nesphome:\n");
  });

  it("add-component keeps the pre-switch target", async () => {
    const dialog = new ESPHomeAddComponentDialog();
    const add = deferred<{ yaml: string }>();
    // `_returnTo` truthy drives the restore branch, which doesn't
    // touch the wa-dialog query — pure logic, no render.
    Object.assign(dialog as unknown as Record<string, unknown>, {
      _api: { addComponent: vi.fn(() => add.promise) },
      _selected: { id: "i2c" },
      _returnTo: { id: "orig" },
      _depDomain: null,
    });
    dialog.configuration = "device.yaml";
    dialog.yaml = "esphome:\n";
    const seen = capture(dialog);

    const submitting = (
      dialog as unknown as { _onFormSubmit: (e: CustomEvent) => Promise<void> }
    )._onFormSubmit(new CustomEvent("form-submit", { detail: { fields: {} } }));
    dialog.configuration = "other.yaml";
    add.resolve({ yaml: "MERGED" });
    await submitting;

    expect(seen).toEqual([
      {
        configuration: "device.yaml",
        yaml: "MERGED",
        basedOn: "esphome:\n",
        node: dialog,
      },
    ]);
  });
});
