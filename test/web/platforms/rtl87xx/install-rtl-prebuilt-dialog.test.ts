// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("../../../../src/components/process-terminal/process-terminal.js", () => ({}));
vi.mock("../../../../src/components/install-details-log.js", () => ({}));

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  loadRtl87xxImage: vi.fn(),
  runAmbz: vi.fn(),
  runAmbz2: vi.fn(),
  fetchEsphomeWebManifest: vi.fn(),
}));
vi.mock("../../../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../../../src/web/util/esphome-web-firmware.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchEsphomeWebManifest: mocks.fetchEsphomeWebManifest,
}));
vi.mock("../../../../src/platforms/rtl87xx/index.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadRtl87xxImage: mocks.loadRtl87xxImage,
  loadAmbzEngine: async () => ({}),
  loadAmbz2Engine: async () => ({}),
  runAmbz: mocks.runAmbz,
  runAmbz2: mocks.runAmbz2,
}));

import { card, mountPrebuilt, radios } from "../_libretiny-dialog.js";
import { RTL87XX_INSTALL } from "../../../../src/web/platforms/rtl87xx/install.js";
import { resetEsphomeWebManifest } from "../../../../src/web/util/esphome-web-firmware.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const AMBZ2_IMAGE = { runs: [], totalBytes: 0 };
const AMBZ_IMAGE = { ota1: AMBZ2_IMAGE, ota2: AMBZ2_IMAGE, ota2Offset: 0x80000 };
const PORT = { getInfo: () => ({}) } as unknown as SerialPort;
const URL = "https://firmware.esphome.io/esphome-web/26.10.0/esphome-web-";

const mountRtlPrebuilt = (...families: string[]) =>
  mountPrebuilt(RTL87XX_INSTALL, mocks.fetchEsphomeWebManifest, ...families);
const text = (el: any) => el.shadowRoot!.textContent ?? "";
let fetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // The RTL8710B's image is the byte 1, the RTL8720C's the byte 2.
  fetch = vi.fn(async (url: string) => ({
    ok: true,
    arrayBuffer: async () =>
      new Uint8Array([url.endsWith("rtl8710b.uf2") ? 1 : 2]).buffer,
  }));
  vi.stubGlobal("fetch", fetch);
  mocks.requestSerialPort.mockResolvedValue(PORT);
  mocks.loadRtl87xxImage.mockImplementation(async (bytes: Uint8Array) =>
    bytes[0] === 1
      ? { image: { chip: "ambz", image: AMBZ_IMAGE } }
      : { image: { chip: "ambz2", image: AMBZ2_IMAGE } }
  );
  mocks.runAmbz.mockResolvedValue({ rebooted: false });
  mocks.runAmbz2.mockResolvedValue({ rebooted: true });
});

afterEach(() => {
  resetEsphomeWebManifest();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("esphome-web-libretiny-install-dialog for the RTL87xx's ESPHome Web firmware", () => {
  it("offers a chip picker, RTL8720C first, when both chips are published", async () => {
    const el = await mountRtlPrebuilt("RTL8720C", "RTL8710B");

    expect(radios(el, "family").map((r) => [r.value, r.checked])).toEqual([
      ["RTL8720C", true],
      ["RTL8710B", false],
    ]);
    expect(text(el)).toContain("web.install.prebuilt_chip_label");
    expect(fetch).toHaveBeenCalledWith(`${URL}rtl8720c.uf2`);

    await el._flash();
    await el.updateComplete;

    expect(mocks.runAmbz2).toHaveBeenCalledWith(PORT, AMBZ2_IMAGE, expect.any(Object));
    expect(card(el).statusMessage).toBe("web.rtl.install_done");
  });

  it("installs the RTL8710B's image with its own downloader and guide when picked", async () => {
    let wait!: () => void;
    mocks.runAmbz.mockImplementation(async (_port, _image, hooks) => {
      hooks.onWaiting();
      await new Promise<void>((resolve) => (wait = resolve));
      return { rebooted: false };
    });
    const el = await mountRtlPrebuilt("RTL8720C", "RTL8710B");

    radios(el, "family")[1].click();
    await vi.waitFor(() =>
      expect(el._setup.image.state).toMatchObject({
        kind: "ready",
        value: { chip: "ambz" },
      })
    );
    expect(fetch).toHaveBeenLastCalledWith(`${URL}rtl8710b.uf2`);
    const flashing = el._flash();
    await vi.waitFor(() => expect(el._state).toBe("waiting"));
    await el.updateComplete;

    expect(mocks.runAmbz).toHaveBeenCalledWith(PORT, AMBZ_IMAGE, expect.any(Object));
    expect(text(el)).toContain("firmware.rtl_ambz_guide_link");
    wait();
    await flashing;
    await el.updateComplete;
    expect(card(el).statusMessage).toBe("web.rtl.install_done_reset");
  });

  it("downloads each chip's image once, however often it is picked", async () => {
    const el = await mountRtlPrebuilt("RTL8720C", "RTL8710B");

    radios(el, "family")[1].click();
    await vi.waitFor(() => expect(el._setup.image.state.kind).toBe("ready"));
    await el.updateComplete;
    radios(el, "family")[0].click();
    await vi.waitFor(() =>
      expect(el._setup.image.state).toMatchObject({ value: { chip: "ambz2" } })
    );

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("offers no chip picker when only one chip is published", async () => {
    const el = await mountRtlPrebuilt("RTL8710B");

    expect(radios(el, "family")).toEqual([]);
    expect(fetch).toHaveBeenCalledWith(`${URL}rtl8710b.uf2`);
  });
});
