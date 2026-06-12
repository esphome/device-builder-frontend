/**
 * @vitest-environment happy-dom
 *
 * Pins the error-jump highlight lifecycle (esphome/device-builder#1404):
 * the "Go to error" highlight clears after an edit's lint pass or a
 * successful save, while navigation highlights stay untouched.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../src/components/command-dialog.js", () => ({}));
vi.mock("../../src/components/device/device-editor.js", () => ({}));
vi.mock("../../src/components/device/device-navigator.js", () => ({}));
vi.mock("../../src/components/firmware-install-dialog.js", () => ({}));
vi.mock("../../src/components/install-method-dialog.js", () => ({}));
vi.mock("../../src/components/logs-dialog.js", () => ({}));
vi.mock("../../src/components/unsaved-changes-dialog.js", () => ({}));
vi.mock("../../src/components/yaml-validation-dialog.js", () => ({}));
vi.mock("../../src/components/device/device-install-controller.js", () => ({
  DeviceInstallController: class {
    constructor() {}
  },
}));

import type { ESPHomeAPI } from "../../src/api/index.js";
import { ESPHomePageDevice } from "../../src/pages/device.js";

const YAML = "esphome:\n  name: kitchen\nswitch:\n  - platform: gpio\n";

function makePage(api: Partial<ESPHomeAPI> = {}): ESPHomePageDevice {
  const page = new ESPHomePageDevice();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._api = api as ESPHomeAPI;
  page.id = "kitchen.yaml";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._yaml = YAML;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._savedYaml = YAML;
  return page;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internals = (page: ESPHomePageDevice) => page as any;

function goToError(page: ESPHomePageDevice, line = 4) {
  internals(page)._onValidationGoTo(
    new CustomEvent("goto", { detail: { line, col: 1 } })
  );
}

function editYaml(page: ESPHomePageDevice, value = YAML + "    pin: GPIO11\n") {
  internals(page)._onYamlChange(new CustomEvent("yaml-change", { detail: { value } }));
}

function lintCompleted(page: ESPHomePageDevice, configuration = "kitchen.yaml") {
  internals(page)._onYamlDiagnostics(
    new CustomEvent("yaml-diagnostics", { detail: { errors: [], configuration } })
  );
}

describe("error-jump highlight lifecycle (#1404)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears after an edit once the lint pass completes", () => {
    const page = makePage();
    goToError(page);
    expect(internals(page)._highlightRange).toEqual({ fromLine: 4, toLine: 4 });

    editYaml(page);
    expect(internals(page)._highlightRange).not.toBeNull();

    lintCompleted(page);
    expect(internals(page)._highlightRange).toBeNull();
    expect(internals(page)._scrollToHighlight).toBe(false);
  });

  it("clears after a form draft edit once the lint pass completes", () => {
    const page = makePage();
    goToError(page);

    internals(page)._onYamlDraft(
      new CustomEvent("yaml-draft", { detail: { yaml: YAML + "    pin: GPIO11\n" } })
    );
    lintCompleted(page);
    expect(internals(page)._highlightRange).toBeNull();
  });

  it("clears after a completed component edit once the lint pass completes", () => {
    const page = makePage();
    goToError(page);

    internals(page)._onYamlUpdated(
      new CustomEvent("yaml-updated", { detail: { yaml: YAML + "    pin: GPIO11\n" } })
    );
    lintCompleted(page);
    expect(internals(page)._highlightRange).toBeNull();
  });

  it("survives a lint pass with no intervening edit", () => {
    const page = makePage();
    goToError(page);

    lintCompleted(page);
    expect(internals(page)._highlightRange).toEqual({ fromLine: 4, toLine: 4 });
  });

  it("ignores a lint result for a different configuration", () => {
    const page = makePage();
    goToError(page);
    editYaml(page);

    lintCompleted(page, "other.yaml");
    expect(internals(page)._highlightRange).toEqual({ fromLine: 4, toLine: 4 });
  });

  it("clears on a successful save", async () => {
    const page = makePage({ updateConfig: vi.fn().mockResolvedValue(undefined) });
    goToError(page);
    editYaml(page);

    await internals(page)._doSaveYaml();
    expect(internals(page)._highlightRange).toBeNull();
  });

  it("survives a failed save", async () => {
    const page = makePage({
      updateConfig: vi.fn().mockRejectedValue(new Error("boom")),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    goToError(page);

    await internals(page)._doSaveYaml();
    expect(internals(page)._highlightRange).toEqual({ fromLine: 4, toLine: 4 });
  });

  it("leaves a navigation highlight alone through edit + lint + save", async () => {
    const page = makePage({ updateConfig: vi.fn().mockResolvedValue(undefined) });
    internals(page)._onYamlHighlight(
      new CustomEvent("yaml-highlight", {
        detail: { range: { fromLine: 2, toLine: 2 }, scroll: true },
      })
    );

    editYaml(page);
    lintCompleted(page);
    expect(internals(page)._highlightRange).toEqual({ fromLine: 2, toLine: 2 });

    await internals(page)._doSaveYaml();
    expect(internals(page)._highlightRange).toEqual({ fromLine: 2, toLine: 2 });
  });
});
