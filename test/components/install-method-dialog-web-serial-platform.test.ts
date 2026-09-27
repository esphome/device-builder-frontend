/**
 * @vitest-environment happy-dom
 *
 * Browser Web Serial flashing (esptool-js) is ESP-only. Non-ESP targets — RP2040 /
 * RP2350, libretiny (bk72xx / rtl87xx / ln882x) — can't be flashed from
 * the browser, so the Web Serial install row is hidden for them; server-serial
 * (`esphome run`) stays available, even on localhost where it's normally
 * collapsed into Web Serial.
 *
 * nRF52, RP2 and the RTL8720C are special cases: they don't get the esptool
 * Web Serial row but do get their own in-browser rows when Web Serial is
 * available. In logs mode the Web Serial row also covers them (their consoles
 * read like any port).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../_mock-webawesome.js";

vi.mock("@home-assistant/webawesome/dist/components/callout/callout.js", () => ({}));

vi.mock("../../src/util/copy-to-clipboard.js", () => ({
  copyToClipboard: vi.fn(async () => true),
}));
vi.mock("../../src/util/notify.js", () => ({
  notify: { success: vi.fn(), warning: vi.fn() },
}));

import { flush } from "../_dom.js";
import { makeConfiguredDevice } from "../_make-configured-device.js";
import { DeviceState } from "../../src/api/types/devices.js";
import { defaultLocalize } from "../../src/common/localize.js";
import { ESPHomeInstallMethodDialog } from "../../src/components/install-method-dialog.js";
import { BRAVE_WEB_BLUETOOTH_FLAG } from "../../src/platforms/nrf52/ble-nus-stream.js";
import { installsFor, platformFor } from "../../src/platforms/registry.js";
import { copyToClipboard } from "../../src/util/copy-to-clipboard.js";
import {
  restoreWebSerialEnv,
  setBluetooth,
  setBrave,
  setLocalhostWithWebSerial,
  setWebSerialEnv,
} from "./_install-method-dialog-env.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// The chip a device reports (``Device.mcu``) when its platform's flasher
// writes it; ``null`` for a platform that is one chip.
const flashableChip = (platform: string): string | null =>
  platformFor(platform)?.installs?.[0]?.chips?.[0] ?? null;

async function mount(
  platform: string,
  mode: "install" | "logs" = "install",
  mcu: string | null = flashableChip(platform),
  loadedPlatforms: string[] = []
): Promise<ESPHomeInstallMethodDialog> {
  const dialog = new ESPHomeInstallMethodDialog();
  dialog.platformInstalls = installsFor(
    makeConfiguredDevice({
      target_platform: platform,
      mcu,
      loaded_platforms: loadedPlatforms,
    })
  );
  (dialog as any)._localize = defaultLocalize;
  (dialog as any)._api = {};
  dialog.deviceState = DeviceState.ONLINE;
  dialog.deviceTargetPlatform = platform;
  dialog.mode = mode;
  dialog.open = true;
  document.body.appendChild(dialog);
  await dialog.updateComplete;
  return dialog;
}

// Rows are identified by their leading icon: Web Serial uses "usb",
// server-serial uses "serial-port". The nRF DFU row shares the "chip" icon
// with the bootloader row, so it's matched by title instead.
const hasWebSerialRow = (d: ESPHomeInstallMethodDialog): boolean =>
  !!d.shadowRoot!.querySelector('wa-icon[name="usb"]');
const hasRowTitled = (d: ESPHomeInstallMethodDialog, key: string): boolean =>
  [...d.shadowRoot!.querySelectorAll(".option .title")].some(
    (el) => el.textContent?.trim() === defaultLocalize(key)
  );
const hasNrfDfuRow = (d: ESPHomeInstallMethodDialog): boolean =>
  hasRowTitled(d, "dashboard.install_method_nrf_dfu");
const hasSmpBleRow = (d: ESPHomeInstallMethodDialog): boolean =>
  hasRowTitled(d, "dashboard.install_method_nrf_smp_ble");
const hasSmpSerialRow = (d: ESPHomeInstallMethodDialog): boolean =>
  hasRowTitled(d, "dashboard.install_method_nrf_smp_serial");
const hasRp2Row = (d: ESPHomeInstallMethodDialog): boolean =>
  hasRowTitled(d, "dashboard.install_method_rp2_uf2");
const hasRtlRow = (d: ESPHomeInstallMethodDialog): boolean =>
  hasRowTitled(d, "dashboard.install_method_rtl_ambz2");
const hasServerSerialRow = (d: ESPHomeInstallMethodDialog): boolean =>
  !!d.shadowRoot!.querySelector('wa-icon[name="serial-port"]');
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  setLocalhostWithWebSerial();
});

afterEach(() => {
  restoreWebSerialEnv();
  vi.restoreAllMocks();
});

describe("install-method-dialog platform gating", () => {
  // ESPHome's platform key for both RP2 chips is "rp2"; the legacy
  // "rp2040" spelling and "rp2350" are included defensively.
  it.each(["rp2", "rp2040", "rp2350", "bk72xx", "rtl87xx", "ln882x"])(
    "hides Web Serial and keeps server-serial for non-ESP platform %s",
    async (platform) => {
      const d = await mount(platform);
      expect(hasWebSerialRow(d)).toBe(false);
      expect(hasServerSerialRow(d)).toBe(true);
    }
  );

  it.each(["esp32", "esp32c3", "esp32s3", "esp8266", "esp8285"])(
    "shows Web Serial for ESP platform %s",
    async (platform) => {
      const d = await mount(platform);
      expect(hasWebSerialRow(d)).toBe(true);
    }
  );

  it("shows nRF DFU row and hides Web Serial for nrf52", async () => {
    const d = await mount("nrf52");
    expect(hasWebSerialRow(d)).toBe(false);
    expect(hasNrfDfuRow(d)).toBe(true);
    expect(hasRp2Row(d)).toBe(false);
    expect(hasServerSerialRow(d)).toBe(true);
  });

  describe("nRF52 MCUboot updates", () => {
    const MCUMGR = ["ota.zephyr_mcumgr"];
    const mountMcumgr = async (loaded = MCUMGR) => {
      const d = await mount("nrf52", "install", null, loaded);
      (d as unknown as { _advancedExpanded: boolean })._advancedExpanded = true;
      await d.updateComplete;
      return d;
    };
    const inAdvanced = (d: ESPHomeInstallMethodDialog, key: string): boolean =>
      [...d.shadowRoot!.querySelectorAll(".advanced-panel-content .option .title")].some(
        (el) => el.textContent?.trim() === defaultLocalize(key)
      );

    it("are not offered to a device whose firmware has no mcumgr", async () => {
      setBluetooth(true);
      const d = await mountMcumgr([]);
      expect(hasNrfDfuRow(d)).toBe(true);
      expect(hasSmpBleRow(d)).toBe(false);
      expect(hasSmpSerialRow(d)).toBe(false);
    });

    it("offer Bluetooth in the list and serial under advanced options", async () => {
      setBluetooth(true);
      const d = await mountMcumgr();
      expect(hasSmpBleRow(d)).toBe(true);
      expect(inAdvanced(d, "dashboard.install_method_nrf_smp_ble")).toBe(false);
      expect(inAdvanced(d, "dashboard.install_method_nrf_smp_serial")).toBe(true);
      expect(inAdvanced(d, "dashboard.install_method_nrf_dfu")).toBe(false);
    });

    it("select their own install method", async () => {
      setBluetooth(true);
      const d = await mountMcumgr();
      const selected: string[] = [];
      d.addEventListener("select-method", (e) =>
        selected.push((e as CustomEvent<{ method: string }>).detail.method)
      );
      for (const key of ["nrf_smp_ble", "nrf_smp_serial"]) {
        const row = [...d.shadowRoot!.querySelectorAll<HTMLElement>(".option")].find(
          (el) =>
            el.querySelector(".title")?.textContent?.trim() ===
            defaultLocalize(`dashboard.install_method_${key}`)
        );
        row!.click();
      }
      expect(selected).toEqual(["nrf-smp-ble", "nrf-smp-serial"]);
    });

    it("hide Bluetooth in a browser without Web Bluetooth", async () => {
      setBluetooth(false);
      const d = await mountMcumgr();
      expect(hasSmpBleRow(d)).toBe(false);
      expect(hasSmpSerialRow(d)).toBe(true);
    });

    it("keep Bluetooth and drop serial without Web Serial", async () => {
      setBluetooth(true);
      setWebSerialEnv({ serial: false, secure: true, href: "http://localhost:6052/" });
      const d = await mountMcumgr();
      expect(hasSmpBleRow(d)).toBe(true);
      expect(hasSmpSerialRow(d)).toBe(false);
    });

    it("are install only", async () => {
      setBluetooth(true);
      const d = await mount("nrf52", "logs", null, MCUMGR);
      (d as unknown as { _advancedExpanded: boolean })._advancedExpanded = true;
      await d.updateComplete;
      expect(hasSmpBleRow(d)).toBe(false);
      expect(hasSmpSerialRow(d)).toBe(false);
    });
  });

  // The Pico row needs only Web Serial (for the 1200-baud reset); WebUSB
  // decides the write button inside the dialog, not the row.
  it.each(["rp2", "rp2040"])("shows the Pico row for %s", async (platform) => {
    const d = await mount(platform);
    expect(hasRp2Row(d)).toBe(true);
    expect(hasNrfDfuRow(d)).toBe(false);
  });

  // One platform, two chips: the row is for the chip the flasher writes, and
  // a chip the backend could not name is not offered it.
  it.each([
    ["rp2", "rp2350"],
    ["rp2", null],
  ])("hides the Pico row for %s with chip %s", async (platform, mcu) => {
    const d = await mount(platform, "install", mcu);
    expect(hasRp2Row(d)).toBe(false);
    expect(hasServerSerialRow(d)).toBe(true);
  });

  it.each([
    ["rtl87xx", "rtl8710b"],
    ["rtl87xx", null],
  ])("hides the RTL8720C row for %s with chip %s", async (platform, mcu) => {
    const d = await mount(platform, "install", mcu);
    expect(hasRtlRow(d)).toBe(false);
    expect(hasServerSerialRow(d)).toBe(true);
  });

  it.each(["esp32", "bk72xx"])("hides the Pico row for %s", async (platform) => {
    const d = await mount(platform);
    expect(hasRp2Row(d)).toBe(false);
  });

  it("hides the Pico row in logs mode (flash-only)", async () => {
    const d = await mount("rp2", "logs");
    expect(hasRp2Row(d)).toBe(false);
  });

  // The RTL8720C ROM downloader is spoken over Web Serial; the row keeps
  // server-serial beside it as the backend path.
  it("shows the RTL8720C row for rtl87xx with Web Serial", async () => {
    const d = await mount("rtl87xx");
    expect(hasRtlRow(d)).toBe(true);
    expect(hasRp2Row(d)).toBe(false);
    expect(hasServerSerialRow(d)).toBe(true);
  });

  it.each(["esp32", "bk72xx", "ln882x"])(
    "hides the RTL8720C row for %s",
    async (platform) => {
      const d = await mount(platform);
      expect(hasRtlRow(d)).toBe(false);
    }
  );

  it("hides the RTL8720C row in logs mode and without Web Serial", async () => {
    expect(hasRtlRow(await mount("rtl87xx", "logs"))).toBe(false);
    setWebSerialEnv({ serial: false, secure: true, href: "http://localhost:6052/" });
    expect(hasRtlRow(await mount("rtl87xx"))).toBe(false);
  });

  // The HA add-on over plain http: Web Serial exists but is blocked here, so
  // the RTL8720C row hands the UF2 to web.esphome.io, as the ESP USB row does.
  it("offers the RTL8720C hand-off on an insecure origin, and nothing for a Pico there", async () => {
    // The browser hides navigator.serial on an insecure origin.
    setWebSerialEnv({
      serial: false,
      secure: false,
      href: "http://homeassistant.local:8123/",
    });
    const d = await mount("rtl87xx");
    expect(hasRtlRow(d)).toBe(true);
    const selected: string[] = [];
    d.addEventListener("select-method", (e) =>
      selected.push((e as CustomEvent<{ method: string }>).detail.method)
    );
    const row = [...d.shadowRoot!.querySelectorAll(".option")].find((el) =>
      el
        .querySelector(".title")
        ?.textContent?.includes(defaultLocalize("dashboard.install_method_rtl_ambz2"))
    ) as HTMLElement;
    row.click();
    expect(selected).toEqual(["web-flash"]);
    expect(hasRp2Row(await mount("rp2"))).toBe(false);
    // The hand-off row is the same row: not for the RTL8710B.
    expect(hasRtlRow(await mount("rtl87xx", "install", "rtl8710b"))).toBe(false);
  });
});

describe("install-method-dialog logs-mode platform gating", () => {
  // The Pico's CDC console reads like any other port, so logs get the Web
  // Serial row; on localhost that collapses the server-serial row, as for ESP.
  // The RTL8720C logs on a plain UART, read like any other port.
  it.each(["rp2", "rp2040", "rp2350", "esp32", "rtl87xx"])(
    "shows Web Serial logs and drops server-serial for %s",
    async (platform) => {
      const d = await mount(platform, "logs");
      expect(hasWebSerialRow(d)).toBe(true);
      expect(hasServerSerialRow(d)).toBe(false);
    }
  );

  it("keeps logs on server-serial for bk72xx", async () => {
    const d = await mount("bk72xx", "logs");
    expect(hasWebSerialRow(d)).toBe(false);
    expect(hasServerSerialRow(d)).toBe(true);
  });

  // nRF52 gets the Web Serial row for logs (USB-CDC console); on localhost
  // that collapses the server-serial row, same as ESP and RP2.
  it("shows Web Serial logs and drops server-serial for nrf52", async () => {
    const d = await mount("nrf52", "logs");
    expect(hasWebSerialRow(d)).toBe(true);
    expect(hasServerSerialRow(d)).toBe(false);
  });
});

describe("install-method-dialog BLE NUS row gating", () => {
  const hasBleNusRow = (d: ESPHomeInstallMethodDialog): boolean =>
    !!d.shadowRoot!.querySelector('wa-icon[name="bluetooth"]');

  beforeEach(() => {
    setBluetooth(true);
  });

  it("shows BLE NUS row for nrf52 in logs mode when Bluetooth is available", async () => {
    const d = await mount("nrf52", "logs");
    expect(hasBleNusRow(d)).toBe(true);
  });

  it("hides BLE NUS row for nrf52 in install mode", async () => {
    const d = await mount("nrf52");
    expect(hasBleNusRow(d)).toBe(false);
  });

  it.each(["esp32", "rp2", "bk72xx"])(
    "hides BLE NUS row for non-nRF platform %s in logs mode",
    async (platform) => {
      const d = await mount(platform, "logs");
      expect(hasBleNusRow(d)).toBe(false);
    }
  );

  it("hides BLE NUS row when Bluetooth is unavailable", async () => {
    setBluetooth(false);
    const d = await mount("nrf52", "logs");
    expect(hasBleNusRow(d)).toBe(false);
  });

  const bleRow = (d: ESPHomeInstallMethodDialog): HTMLElement =>
    d.shadowRoot!.querySelector('wa-icon[name="bluetooth"]')!.closest(".option")!;
  // Lets the adapter's answer land and the row re-render.
  const settle = async (d: ESPHomeInstallMethodDialog): Promise<void> => {
    await flush();
    await d.updateComplete;
  };

  it("keeps the row non-actionable until the adapter answers", async () => {
    setBluetooth(true, () => new Promise<boolean>(() => {}));
    const d = await mount("nrf52", "logs");
    expect(bleRow(d).classList.contains("option--disabled")).toBe(true);
    expect(bleRow(d).textContent).toContain(
      defaultLocalize("dashboard.logs_method_ble_nus_desc")
    );
    expect(bleRow(d).querySelector(".copy-address")).toBeNull();
  });

  it("enables the row once the adapter answers available", async () => {
    const d = await mount("nrf52", "logs");
    await settle(d);
    expect(bleRow(d).classList.contains("option--disabled")).toBe(false);
  });

  it("disables the row with a hint when the adapter is off or blocked", async () => {
    setBluetooth(true, async () => false);
    const d = await mount("nrf52", "logs");
    await settle(d);
    expect(bleRow(d).classList.contains("option--disabled")).toBe(true);
    expect(bleRow(d).textContent).toContain(
      defaultLocalize("dashboard.logs_method_ble_nus_off")
    );
    expect(bleRow(d).querySelector(".copy-address")).toBeNull();
  });

  it("takes only the newest open's answer, so a slow earlier probe cannot disable the row", async () => {
    let resolveFirst!: (available: boolean) => void;
    const answers = [
      new Promise<boolean>((r) => (resolveFirst = r)),
      Promise.resolve(true),
    ];
    setBluetooth(true, () => answers.shift()!);
    const d = await mount("nrf52", "logs");
    d.open = false;
    await d.updateComplete;
    d.open = true;
    await d.updateComplete;
    resolveFirst(false);
    await settle(d);
    expect(bleRow(d).classList.contains("option--disabled")).toBe(false);
  });

  it("names the Brave flag when Brave has Web Bluetooth switched off", async () => {
    setBluetooth(true, async () => false);
    setBrave();
    const d = await mount("nrf52", "logs");
    await settle(d);
    expect(bleRow(d).textContent).toContain(
      defaultLocalize("dashboard.logs_method_ble_nus_off")
    );
    expect(bleRow(d).textContent).toContain(
      defaultLocalize("dashboard.logs_method_ble_nus_brave")
    );
    const copy = bleRow(d).querySelector<HTMLButtonElement>("button.copy-address")!;
    expect(copy.textContent).toContain(BRAVE_WEB_BLUETOOTH_FLAG);
    copy.click();
    await flush();
    expect(copyToClipboard).toHaveBeenCalledWith(BRAVE_WEB_BLUETOOTH_FLAG);
  });
});
