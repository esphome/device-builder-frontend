/**
 * @vitest-environment happy-dom
 *
 * Pins that the adopt _submit guards re-entry, so the Enter path (which
 * bypasses the disabled button via the shared EnterController) can't
 * double-import on a held Enter. The Enter->action wiring itself mirrors
 * friendly-name-dialog and is covered there.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/util/notify.js", () => ({
  notifyWarning: vi.fn(),
}));

import "../_mock-webawesome.js";

import { deviceNameInputsOf, flush, mount } from "../_dom.js";
import type { AdoptableDevice } from "../../src/api/types/devices.js";
import { ESPHomeAdoptDialog } from "../../src/components/adopt-dialog.js";
import { _resetSecretKeysCache } from "../../src/util/secrets-cache.js";

const DEVICE = {
  name: "foo-1234",
  friendly_name: "Foo",
  project_name: "acme.widget",
  package_import_url: "github://acme/widget/widget.yaml@main",
} as unknown as AdoptableDevice;

const wifiDevice = (): AdoptableDevice =>
  ({ ...DEVICE, network: "wifi" }) as unknown as AdoptableDevice;
const ethernetDevice = (): AdoptableDevice =>
  ({ ...DEVICE, network: "ethernet" }) as unknown as AdoptableDevice;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Priv = any;

async function makeDialog(secretKeys: string[]): Promise<{
  priv: Priv;
  getSecretKeys: ReturnType<typeof vi.fn>;
  setWifiCredentials: ReturnType<typeof vi.fn>;
  importDevice: ReturnType<typeof vi.fn>;
}> {
  const getSecretKeys = vi.fn(async () => secretKeys);
  const setWifiCredentials = vi.fn(async () => {});
  const importDevice = vi.fn(async () => ({ configuration: "foo-1234.yaml" }));
  const el = await mount(new ESPHomeAdoptDialog());
  const priv = el as Priv;
  priv._api = { getSecretKeys, setWifiCredentials, importDevice };
  return { priv, getSecretKeys, setWifiCredentials, importDevice };
}

/** Open the dialog and settle the deferred name-pair seed. */
async function openSettled(priv: Priv, device: AdoptableDevice): Promise<void> {
  priv.open(device);
  await priv.updateComplete;
  await flush();
  await priv.updateComplete;
}

/** Type into the nested hostname field (expanding the disclosure). */
async function typeHostname(priv: Priv, value: string): Promise<void> {
  const inputs = await deviceNameInputsOf(priv);
  const toggle =
    inputs.shadowRoot!.querySelector<HTMLButtonElement>(".disclosure-toggle");
  if (toggle && !toggle.disabled) {
    toggle.click();
    await inputs.updateComplete;
  }
  const field = inputs.shadowRoot!.querySelector<HTMLInputElement>("#device-hostname")!;
  field.value = value;
  field.dispatchEvent(new Event("input"));
  await inputs.updateComplete;
  await priv.updateComplete;
}

describe("adopt-dialog re-entry guard", () => {
  it("_submit ignores re-entry while an import is in flight", async () => {
    const { priv } = await makeDialog([]);
    const importDevice = vi.fn(() => new Promise<void>(() => {})); // stays in flight
    priv._api = { importDevice };
    await openSettled(priv, ethernetDevice());

    void priv._submit();
    await priv._submit();

    expect(importDevice).toHaveBeenCalledTimes(1);
  });
});

describe("adopt-then-rename (#2412)", () => {
  it("imports under the factory name and requests a rename for an edited name", async () => {
    const { priv, importDevice } = await makeDialog([]);
    const adopted = vi.fn();
    (priv as EventTarget).addEventListener("adopted", adopted);
    await openSettled(priv, ethernetDevice());
    await typeHostname(priv, "kitchen");

    await priv._submit();

    // The running device only answers to its factory broadcast name;
    // the edited name rides the adopted event for the rename flow.
    expect(importDevice).toHaveBeenCalledWith(
      expect.objectContaining({ name: "foo-1234" })
    );
    expect(adopted).toHaveBeenCalledTimes(1);
    expect(adopted.mock.calls[0][0].detail).toEqual({
      name: "foo-1234",
      configuration: "foo-1234.yaml",
      friendlyName: "Foo",
      renameTo: "kitchen",
    });
  });

  it("surfaces the backend's package-resolution warning and still adopts", async () => {
    const { notifyWarning } = await import("../../src/util/notify.js");
    vi.mocked(notifyWarning).mockClear();
    const { priv, importDevice } = await makeDialog([]);
    importDevice.mockResolvedValue({
      configuration: "foo-1234.yaml",
      warning: "Imported, but the remote package didn't resolve",
    });
    const adopted = vi.fn();
    (priv as EventTarget).addEventListener("adopted", adopted);
    await openSettled(priv, ethernetDevice());

    await priv._submit();

    expect(notifyWarning).toHaveBeenCalledWith("dashboard.adopt_package_warning", {
      description: "Imported, but the remote package didn't resolve",
      duration: 8000,
    });
    expect(adopted).toHaveBeenCalledTimes(1);
    expect(priv._error).toBeNull();
  });

  it("requests no rename when the name is unedited", async () => {
    const { priv, importDevice } = await makeDialog([]);
    const adopted = vi.fn();
    (priv as EventTarget).addEventListener("adopted", adopted);
    await openSettled(priv, ethernetDevice());

    await priv._submit();

    expect(importDevice).toHaveBeenCalledWith(
      expect.objectContaining({ name: "foo-1234" })
    );
    expect(adopted).toHaveBeenCalledTimes(1);
    expect(adopted.mock.calls[0][0].detail).toEqual({
      name: "foo-1234",
      configuration: "foo-1234.yaml",
      friendlyName: "Foo",
      renameTo: null,
    });
  });

  it("re-derives the hostname from a friendly-name edit", async () => {
    const { priv, importDevice } = await makeDialog([]);
    const adopted = vi.fn();
    (priv as EventTarget).addEventListener("adopted", adopted);
    await openSettled(priv, ethernetDevice());
    const inputs = await deviceNameInputsOf(priv);
    const friendly = inputs.shadowRoot!.querySelector<HTMLInputElement>(
      "#device-friendly-name"
    )!;
    friendly.value = "Kitchen Sensor";
    friendly.dispatchEvent(new Event("input"));
    await inputs.updateComplete;
    await priv.updateComplete;

    await priv._submit();

    // Same idiom as create/rename: the seeded broadcast hostname holds
    // only until the user types, then derivation takes over and the
    // recalced name rides the rename flow.
    expect(importDevice).toHaveBeenCalledWith(
      expect.objectContaining({ name: "foo-1234", friendly_name: "Kitchen Sensor" })
    );
    expect(adopted.mock.calls[0][0].detail.renameTo).toBe("kitchen-sensor");
  });

  it("returns the hostname to the factory broadcast when the friendly name is cleared", async () => {
    const { priv, importDevice } = await makeDialog([]);
    const adopted = vi.fn();
    (priv as EventTarget).addEventListener("adopted", adopted);
    await openSettled(priv, ethernetDevice());
    const inputs = await deviceNameInputsOf(priv);
    const friendly = inputs.shadowRoot!.querySelector<HTMLInputElement>(
      "#device-friendly-name"
    )!;
    friendly.value = "";
    friendly.dispatchEvent(new Event("input"));
    await inputs.updateComplete;
    await priv.updateComplete;

    await priv._submit();

    // The seed doubles as the derivation fallback — an empty friendly
    // name must not strand an empty hostname behind a disabled submit.
    expect(importDevice).toHaveBeenCalledWith(
      expect.objectContaining({ name: "foo-1234" })
    );
    expect(adopted).toHaveBeenCalledTimes(1);
    expect(adopted.mock.calls[0][0].detail.renameTo).toBe(null);
  });

  it("refuses to submit an edited name that is already taken", async () => {
    const { priv, importDevice } = await makeDialog([]);
    priv.takenHostnames = new Set(["foo-1234", "kitchen"]);
    await openSettled(priv, ethernetDevice());
    await typeHostname(priv, "kitchen");

    await priv._submit();

    expect(importDevice).not.toHaveBeenCalled();
  });

  it("refuses an edited name past the 31-char hostname cap", async () => {
    const { priv, importDevice } = await makeDialog([]);
    await openSettled(priv, ethernetDevice());
    await typeHostname(priv, "a".repeat(32));

    await priv._submit();

    expect(importDevice).not.toHaveBeenCalled();
  });

  it("refuses an edited name with an edge hyphen", async () => {
    const { priv, importDevice } = await makeDialog([]);
    await openSettled(priv, ethernetDevice());
    await typeHostname(priv, "-kitchen");

    await priv._submit();

    expect(importDevice).not.toHaveBeenCalled();
  });

  it("exempts the unedited factory name from the taken set", async () => {
    const { priv, importDevice } = await makeDialog([]);
    // The device's own importable row puts its broadcast name in the set.
    priv.takenHostnames = new Set(["foo-1234"]);
    await openSettled(priv, ethernetDevice());

    await priv._submit();

    expect(importDevice).toHaveBeenCalledTimes(1);
  });
});

describe("adopt-dialog wifi step (#1742)", () => {
  beforeEach(() => {
    _resetSecretKeysCache();
  });

  it("collects wifi for a wifi device with no shared secret", async () => {
    const { priv, getSecretKeys } = await makeDialog([]);
    await openSettled(priv, wifiDevice());
    await vi.waitFor(() => expect(priv._hasWifiSecrets).toBe(false));
    expect(getSecretKeys).toHaveBeenCalledTimes(1);
    expect(priv._collectWifi).toBe(true);
  });

  it("skips the wifi step when the shared secret already exists", async () => {
    const { priv } = await makeDialog(["wifi_ssid", "wifi_password"]);
    await openSettled(priv, wifiDevice());
    await vi.waitFor(() => expect(priv._hasWifiSecrets).toBe(true));
    expect(priv._collectWifi).toBe(false);
  });

  it("never probes secrets or collects wifi for an ethernet device", async () => {
    const { priv, getSecretKeys } = await makeDialog([]);
    await openSettled(priv, ethernetDevice());
    expect(getSecretKeys).not.toHaveBeenCalled();
    expect(priv._collectWifi).toBe(false);
  });

  it("stores the typed credentials before importing and fires secrets-saved", async () => {
    const { priv, setWifiCredentials, importDevice } = await makeDialog([]);
    const savedListener = vi.fn();
    window.addEventListener("secrets-saved", savedListener);
    await openSettled(priv, wifiDevice());
    await vi.waitFor(() => expect(priv._collectWifi).toBe(true));
    // Whitespace in an SSID is significant; the raw value is stored verbatim.
    priv._ssid = " My Home Wifi ";
    priv._password = "hunter2hunter";

    await priv._submit();

    expect(setWifiCredentials).toHaveBeenCalledWith(" My Home Wifi ", "hunter2hunter");
    expect(setWifiCredentials.mock.invocationCallOrder[0]).toBeLessThan(
      importDevice.mock.invocationCallOrder[0]
    );
    expect(savedListener).toHaveBeenCalled();
    window.removeEventListener("secrets-saved", savedListener);
  });

  it("_submit re-checks the wifi gate so Enter can't skip the store", async () => {
    const { priv, setWifiCredentials, importDevice } = await makeDialog([]);
    await openSettled(priv, wifiDevice());
    await vi.waitFor(() => expect(priv._collectWifi).toBe(true));
    // SSID still empty: the Enter path (calls _submit directly, bypassing
    // the disabled button) must refuse rather than import an unresolved
    // !secret or store an empty SSID.
    await priv._submit();

    expect(setWifiCredentials).not.toHaveBeenCalled();
    expect(importDevice).not.toHaveBeenCalled();
  });

  it("does not store credentials when the shared secret already exists", async () => {
    const { priv, setWifiCredentials, importDevice } = await makeDialog([
      "wifi_ssid",
      "wifi_password",
    ]);
    await openSettled(priv, wifiDevice());
    await vi.waitFor(() => expect(priv._hasWifiSecrets).toBe(true));

    await priv._submit();

    expect(setWifiCredentials).not.toHaveBeenCalled();
    expect(importDevice).toHaveBeenCalledTimes(1);
  });

  it("blocks submit while the secret probe is still in flight", async () => {
    // The probe never resolves, so _hasWifiSecrets stays undefined.
    let release: (keys: string[]) => void = () => {};
    const getSecretKeys = vi.fn(
      () => new Promise<string[]>((resolve) => (release = resolve))
    );
    const setWifiCredentials = vi.fn(async () => {});
    const importDevice = vi.fn(async () => ({ configuration: "foo-1234.yaml" }));
    const priv = (await mount(new ESPHomeAdoptDialog())) as Priv;
    priv._api = { getSecretKeys, setWifiCredentials, importDevice };
    await openSettled(priv, wifiDevice());

    // A fast Enter (calls _submit directly) before the probe resolves must
    // neither store a half-known secret nor import an unresolved !secret.
    expect(priv._wifiBlocking).toBe(true);
    await priv._submit();
    expect(setWifiCredentials).not.toHaveBeenCalled();
    expect(importDevice).not.toHaveBeenCalled();
    release([]); // let the dangling promise settle
  });

  it("blocks submit when the password is too short", async () => {
    const { priv, setWifiCredentials, importDevice } = await makeDialog([]);
    await openSettled(priv, wifiDevice());
    await vi.waitFor(() => expect(priv._collectWifi).toBe(true));
    priv._ssid = "My Home Wifi";
    priv._password = "short"; // 1–7 chars trips isWifiPasswordTooShort

    expect(priv._wifiBlocking).toBe(true);
    await priv._submit();

    expect(setWifiCredentials).not.toHaveBeenCalled();
    expect(importDevice).not.toHaveBeenCalled();
  });

  it("allows an open network (empty password) and stores it verbatim", async () => {
    const { priv, setWifiCredentials, importDevice } = await makeDialog([]);
    await openSettled(priv, wifiDevice());
    await vi.waitFor(() => expect(priv._collectWifi).toBe(true));
    priv._ssid = "OpenNet";
    priv._password = ""; // empty is not "too short" — open network

    expect(priv._wifiBlocking).toBe(false);
    await priv._submit();

    expect(setWifiCredentials).toHaveBeenCalledWith("OpenNet", "");
    expect(importDevice).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog open and skips import when storing the secret fails", async () => {
    const { priv, importDevice } = await makeDialog([]);
    priv._api.setWifiCredentials = vi.fn(async () => {
      throw new Error("disk full");
    });
    await openSettled(priv, wifiDevice());
    await vi.waitFor(() => expect(priv._collectWifi).toBe(true));
    priv._ssid = "My Home Wifi";
    priv._password = "hunter2hunter";

    await priv._submit();

    // The store threw, so import never ran and the dialog stays open with
    // the error surfaced and the button live again.
    expect(importDevice).not.toHaveBeenCalled();
    expect(priv._error).toBe("disk full");
    expect(priv._busy).toBe(false);
    expect(priv._dialog.open).toBe(true);
  });

  it("does not collect wifi when the device advertised no network", async () => {
    const { priv, getSecretKeys } = await makeDialog([]);
    await openSettled(priv, {
      ...DEVICE,
      network: "",
    } as unknown as AdoptableDevice);

    expect(getSecretKeys).not.toHaveBeenCalled();
    expect(priv._collectWifi).toBe(false);
    expect(priv._wifiBlocking).toBe(false);
  });
});
