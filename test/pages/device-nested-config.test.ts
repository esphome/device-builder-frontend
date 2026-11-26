// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";

import "./_mock-device-children.js";

vi.mock("../../src/util/navigation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/util/navigation.js")>()),
  navigate: vi.fn().mockResolvedValue(true),
}));

import { makeConfiguredDevice } from "../_make-configured-device.js";
import type { ConfiguredDevice } from "../../src/api/types/devices.js";
import { ESPHomePageDevice } from "../../src/pages/device.js";
import { navigate } from "../../src/util/navigation.js";

/** A device nested under ``devices/`` keeps its literal slashes in every
 *  URL the device page builds for itself. */
interface NestedView {
  id: string;
  _yaml: string;
  _savedYaml: string;
  _devices: ConfiguredDevice[];
  readonly _device: ConfiguredDevice | null;
  _leaveGuard: { handlePopState(e: PopStateEvent): void };
  _confirmLeave(): Promise<boolean>;
  _onUnsavedCancel(): void;
  _onRequestOpenEditor(e: CustomEvent<{ configuration: string }>): void;
}

const NESTED = "devices/lights/desk lamp.yaml";
const NESTED_URL = "/device/devices/lights/desk%20lamp.yaml";

function makePage(): NestedView {
  const page = new ESPHomePageDevice() as unknown as NestedView;
  page.id = NESTED;
  return page;
}

const openEditor = (configuration: string) =>
  new CustomEvent("request-open-editor", { detail: { configuration } });

afterEach(() => {
  window.history.replaceState({}, "", "/");
  vi.clearAllMocks();
});

describe("device page with a nested configuration", () => {
  test("a dirty leave re-pushes the nested editor URL with literal slashes", () => {
    const page = makePage();
    page._yaml = "esphome:\n  name: edited\n";
    page._savedYaml = "esphome:\n  name: desk\n";
    Object.defineProperty(page, "_unsavedDialog", { value: { open: vi.fn() } });
    const pushState = vi.spyOn(window.history, "pushState");

    page._leaveGuard.handlePopState({
      stopImmediatePropagation: vi.fn(),
    } as unknown as PopStateEvent);

    expect(pushState).toHaveBeenCalledWith({}, "", NESTED_URL);
    page._onUnsavedCancel();
  });

  test("request-open-editor for another nested device navigates there", () => {
    const page = makePage();
    page._devices = [makeConfiguredDevice({ configuration: NESTED })];
    expect(page._device?.configuration).toBe(NESTED);

    page._onRequestOpenEditor(openEditor("devices/plugs/kettle.yaml"));

    expect(navigate).toHaveBeenCalledWith("/device/devices/plugs/kettle.yaml");
  });

  test("request-open-editor for the open device stays put", () => {
    const page = makePage();
    page._devices = [makeConfiguredDevice({ configuration: NESTED })];

    page._onRequestOpenEditor(openEditor(NESTED));

    expect(navigate).not.toHaveBeenCalled();
  });
});
