/**
 * @vitest-environment happy-dom
 *
 * A finished compile (plain or deferred-install) for a device on this
 * dashboard offers Download firmware beside Close; install success, the
 * error state, and a build for a configuration this dashboard doesn't
 * know do not. The button hands the resolved device off through
 * request-download-firmware so the host's download flow lists the
 * artifacts without recompiling.
 */
import { describe, expect, it, vi } from "vitest";

import "../_mock-webawesome.js";
import { identityLocalize } from "../_dom.js";
import { visitTemplates } from "../_lit-template-walker.js";
import type { ConfiguredDevice } from "../../src/api/types/devices.js";
import { ESPHomeCommandDialog } from "../../src/components/command-dialog.js";
import { renderActions } from "../../src/components/command-dialog/renderers.js";

const DEVICE = { configuration: "kitchen.yaml", name: "kitchen" } as ConfiguredDevice;

function renderFor(commandType: string, state: string, localDevice?: ConfiguredDevice) {
  const host = {
    _commandType: commandType,
    _state: state,
    _localDevice: localDevice,
    _localize: identityLocalize,
    close: vi.fn(),
    _flipToLogs: vi.fn(),
    _requestDownloadFirmware: vi.fn(),
  };
  const values: unknown[] = [];
  visitTemplates(renderActions(host as unknown as ESPHomeCommandDialog), (t) =>
    values.push(...t.values)
  );
  return { host, values };
}

describe("command-dialog compile download action", () => {
  it.each(["compile", "offline_compile"])(
    "offers Download firmware and Close after a successful %s",
    (type) => {
      const { host, values } = renderFor(type, "success", DEVICE);
      expect(values).toContain(host._requestDownloadFirmware);
      expect(values).toContain(host.close);
    }
  );

  it.each([
    ["install", "success", DEVICE],
    ["compile", "error", DEVICE],
    ["validate", "success", DEVICE],
    ["compile", "success", undefined],
  ])("does not offer it for %s in the %s state (device %o)", (type, state, device) => {
    const { host, values } = renderFor(type, state, device);
    expect(values).not.toContain(host._requestDownloadFirmware);
  });

  it("_requestDownloadFirmware closes and fires the resolved device", () => {
    const dialog = new ESPHomeCommandDialog();
    dialog.configuration = "kitchen.yaml";
    dialog._devices = [DEVICE];
    const close = vi.spyOn(dialog, "close").mockImplementation(() => {});
    const seen: unknown[] = [];
    dialog.addEventListener("request-download-firmware", (e) =>
      seen.push((e as CustomEvent).detail)
    );
    dialog._requestDownloadFirmware();
    expect(close).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([DEVICE]);
  });

  it("_requestDownloadFirmware fires nothing for an unknown configuration", () => {
    const dialog = new ESPHomeCommandDialog();
    dialog.configuration = "peer-only.yaml";
    dialog._devices = [DEVICE];
    vi.spyOn(dialog, "close").mockImplementation(() => {});
    const seen: unknown[] = [];
    dialog.addEventListener("request-download-firmware", (e) =>
      seen.push((e as CustomEvent).detail)
    );
    dialog._requestDownloadFirmware();
    expect(seen).toEqual([]);
  });
});
