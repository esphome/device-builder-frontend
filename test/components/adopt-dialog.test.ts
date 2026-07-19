/**
 * @vitest-environment happy-dom
 *
 * Pins that the adopt _submit guards re-entry, so the Enter path (which
 * bypasses the disabled button via the shared EnterController) can't
 * double-import on a held Enter. The Enter->action wiring itself mirrors
 * friendly-name-dialog and is covered there.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

function makeDialog(secretKeys: string[]): {
  priv: Priv;
  getSecretKeys: ReturnType<typeof vi.fn>;
  setWifiCredentials: ReturnType<typeof vi.fn>;
  importDevice: ReturnType<typeof vi.fn>;
} {
  const getSecretKeys = vi.fn(async () => secretKeys);
  const setWifiCredentials = vi.fn(async () => {});
  const importDevice = vi.fn(async () => ({ configuration: "foo-1234.yaml" }));
  const el = new ESPHomeAdoptDialog();
  const priv = el as Priv;
  priv._api = { getSecretKeys, setWifiCredentials, importDevice };
  return { priv, getSecretKeys, setWifiCredentials, importDevice };
}

describe("adopt-dialog re-entry guard", () => {
  it("_submit ignores re-entry while an import is in flight", async () => {
    const importDevice = vi.fn(() => new Promise<void>(() => {})); // stays in flight
    const el = new ESPHomeAdoptDialog();
    const priv = el as Priv;
    priv._api = { importDevice };
    priv._device = DEVICE;
    priv._name = "foo-1234";

    void priv._submit();
    await priv._submit();

    expect(importDevice).toHaveBeenCalledTimes(1);
  });
});

describe("adopt-dialog wifi step (#1742)", () => {
  beforeEach(() => {
    _resetSecretKeysCache();
  });

  it("collects wifi for a wifi device with no shared secret", async () => {
    const { priv, getSecretKeys } = makeDialog([]);
    priv.open(wifiDevice());
    await vi.waitFor(() => expect(priv._hasWifiSecrets).toBe(false));
    expect(getSecretKeys).toHaveBeenCalledTimes(1);
    expect(priv._collectWifi).toBe(true);
  });

  it("skips the wifi step when the shared secret already exists", async () => {
    const { priv } = makeDialog(["wifi_ssid", "wifi_password"]);
    priv.open(wifiDevice());
    await vi.waitFor(() => expect(priv._hasWifiSecrets).toBe(true));
    expect(priv._collectWifi).toBe(false);
  });

  it("never probes secrets or collects wifi for an ethernet device", async () => {
    const { priv, getSecretKeys } = makeDialog([]);
    priv.open(ethernetDevice());
    expect(getSecretKeys).not.toHaveBeenCalled();
    expect(priv._collectWifi).toBe(false);
  });

  it("stores the typed credentials before importing and fires secrets-saved", async () => {
    const { priv, setWifiCredentials, importDevice } = makeDialog([]);
    const savedListener = vi.fn();
    window.addEventListener("secrets-saved", savedListener);
    priv.open(wifiDevice());
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
    const { priv, setWifiCredentials, importDevice } = makeDialog([]);
    priv.open(wifiDevice());
    await vi.waitFor(() => expect(priv._collectWifi).toBe(true));
    // SSID still empty: the Enter path (calls _submit directly, bypassing
    // the disabled button) must refuse rather than import an unresolved
    // !secret or store an empty SSID.
    await priv._submit();

    expect(setWifiCredentials).not.toHaveBeenCalled();
    expect(importDevice).not.toHaveBeenCalled();
  });

  it("does not store credentials when the shared secret already exists", async () => {
    const { priv, setWifiCredentials, importDevice } = makeDialog([
      "wifi_ssid",
      "wifi_password",
    ]);
    priv.open(wifiDevice());
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
    const priv = new ESPHomeAdoptDialog() as Priv;
    priv._api = { getSecretKeys, setWifiCredentials, importDevice };
    priv.open(wifiDevice());

    // A fast Enter (calls _submit directly) before the probe resolves must
    // neither store a half-known secret nor import an unresolved !secret.
    expect(priv._wifiBlocking).toBe(true);
    await priv._submit();
    expect(setWifiCredentials).not.toHaveBeenCalled();
    expect(importDevice).not.toHaveBeenCalled();
    release([]); // let the dangling promise settle
  });

  it("blocks submit when the password is too short", async () => {
    const { priv, setWifiCredentials, importDevice } = makeDialog([]);
    priv.open(wifiDevice());
    await vi.waitFor(() => expect(priv._collectWifi).toBe(true));
    priv._ssid = "My Home Wifi";
    priv._password = "short"; // 1–7 chars trips isWifiPasswordTooShort

    expect(priv._wifiBlocking).toBe(true);
    await priv._submit();

    expect(setWifiCredentials).not.toHaveBeenCalled();
    expect(importDevice).not.toHaveBeenCalled();
  });

  it("allows an open network (empty password) and stores it verbatim", async () => {
    const { priv, setWifiCredentials, importDevice } = makeDialog([]);
    priv.open(wifiDevice());
    await vi.waitFor(() => expect(priv._collectWifi).toBe(true));
    priv._ssid = "OpenNet";
    priv._password = ""; // empty is not "too short" — open network

    expect(priv._wifiBlocking).toBe(false);
    await priv._submit();

    expect(setWifiCredentials).toHaveBeenCalledWith("OpenNet", "");
    expect(importDevice).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog open and skips import when storing the secret fails", async () => {
    const { priv, importDevice } = makeDialog([]);
    priv._api.setWifiCredentials = vi.fn(async () => {
      throw new Error("disk full");
    });
    priv.open(wifiDevice());
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
    const { priv, getSecretKeys } = makeDialog([]);
    priv.open({ ...DEVICE, network: "" } as unknown as AdoptableDevice);

    expect(getSecretKeys).not.toHaveBeenCalled();
    expect(priv._collectWifi).toBe(false);
    expect(priv._wifiBlocking).toBe(false);
  });
});
