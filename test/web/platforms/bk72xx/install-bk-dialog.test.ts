// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("../../../../src/components/process-terminal/process-terminal.js", () => ({}));
vi.mock("../../../../src/components/install-details-log.js", () => ({}));

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  loadBekenImage: vi.fn(),
  loadBekenEngine: vi.fn(),
  loadBekenParser: vi.fn(),
  runBeken: vi.fn(),
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
vi.mock("../../../../src/platforms/bk72xx/index.js", async (importOriginal) => ({
  BEKEN_FAMILIES: (
    await importOriginal<typeof import("../../../../src/platforms/bk72xx/index.js")>()
  ).BEKEN_FAMILIES,
  loadBekenImage: mocks.loadBekenImage,
  loadBekenEngine: mocks.loadBekenEngine,
  loadBekenParser: mocks.loadBekenParser,
  runBeken: mocks.runBeken,
}));

import {
  card,
  guide,
  installButton,
  manifest,
  mountInstall,
  mountPrebuilt,
  pickUf2,
  radios,
  stubUf2Download,
  uf2,
} from "../_libretiny-dialog.js";
import { pickerText } from "../../_pick-file.js";
import { argsLocalize } from "../../../_dom.js";
import { BK_INSTALL } from "../../../../src/web/platforms/bk72xx/install.js";
import { resetEsphomeWebManifest } from "../../../../src/web/util/esphome-web-firmware.js";

// The deadline every UF2 download is given.
const SIGNAL = { signal: expect.any(AbortSignal) };

/* eslint-disable @typescript-eslint/no-explicit-any */

const IMAGE = { familyId: 0x159ac324, board: "b", runs: [], totalBytes: 0 };
const PORT = { getInfo: () => ({}) } as unknown as SerialPort;

async function mountDialog(): Promise<any> {
  const el = await mountInstall(BK_INSTALL);
  await pickUf2(el, uf2());
  return el;
}

const mountBkPrebuilt = (...families: string[]) =>
  mountPrebuilt(BK_INSTALL, mocks.fetchEsphomeWebManifest, ...families);

beforeEach(() => {
  mocks.loadBekenImage.mockResolvedValue({ image: IMAGE });
  mocks.loadBekenEngine.mockResolvedValue({});
  mocks.loadBekenParser.mockResolvedValue({});
  mocks.requestSerialPort.mockResolvedValue(PORT);
  mocks.runBeken.mockResolvedValue({ rebooted: true });
  mocks.fetchEsphomeWebManifest.mockResolvedValue(manifest());
});

afterEach(() => {
  resetEsphomeWebManifest();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("esphome-web-libretiny-install-dialog for the BK72xx", () => {
  it("is titled and worded for the BK72xx", async () => {
    const el = await mountDialog();

    expect(el.shadowRoot!.querySelector("esphome-base-dialog").label).toBe(
      "web.bk.install_title"
    );
    expect(el.shadowRoot!.textContent).toContain("web.bk.install_intro");
  });

  it("flashes the parsed UF2 on the picked port and says the device is starting", async () => {
    const el = await mountDialog();

    await el._flash();
    await el.updateComplete;

    expect(mocks.runBeken).toHaveBeenCalledWith(PORT, IMAGE, expect.any(Object));
    expect(card(el).state).toBe("success");
    expect(card(el).statusMessage).toBe("firmware.status_done web.bk.logs_elsewhere");
  });

  it("shows the reset guide while the engine waits for the chip", async () => {
    let finish!: () => void;
    mocks.runBeken.mockImplementation(async (_port, _image, hooks) => {
      hooks.onWaiting();
      await new Promise<void>((resolve) => (finish = resolve));
      return { rebooted: true };
    });
    const el = await mountDialog();

    const flashing = el._flash();
    await vi.waitFor(() => expect(el._state).toBe("waiting"));
    await el.updateComplete;

    expect(card(el).statusMessage).toBe("firmware.bk_wait_title");
    expect(guide(el).href).toBe("https://docs.libretiny.eu/docs/platform/beken-72xx/");
    expect(guide(el).textContent).toBe("firmware.bk_guide_link");
    finish();
    await flashing;
  });

  it.each([
    ["firmware.bk_wrong_chip", "firmware.bk_wrong_chip"],
    ["firmware.bk_unknown_flash", "firmware.bk_unknown_flash"],
    [undefined, "firmware.bk_flash_failed"],
  ])("names a failure by its own copy (%s)", async (key, title) => {
    mocks.runBeken.mockResolvedValue({ detail: "why", error: new Error("why"), key });
    const el = await mountDialog();

    await el._flash();
    await el.updateComplete;

    expect(card(el).state).toBe("error");
    expect(card(el).statusMessage).toBe(title);
  });

  it("names a build for a chip that is not Beken's under the picker", async () => {
    mocks.loadBekenImage.mockResolvedValue({
      key: "firmware.bk_wrong_family",
      detail: "family 0xe08f7564",
    });
    const el = await mountInstall(BK_INSTALL);

    await pickUf2(el, uf2());

    expect(pickerText(el).error).toBe("firmware.bk_wrong_family: family 0xe08f7564");
    expect(mocks.runBeken).not.toHaveBeenCalled();
  });
});

describe("esphome-web-libretiny-install-dialog for the BK72xx's ESPHome Web firmware", () => {
  it("offers it with no chip to pick and nothing fetched, warming the engine and parser", async () => {
    const fetch = stubUf2Download();
    const el = await mountBkPrebuilt("BK7231N", "BK7238");

    expect(radios(el, "mode")[0].checked).toBe(true);
    expect(radios(el, "family")).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.loadBekenEngine).toHaveBeenCalled();
    expect(mocks.loadBekenParser).toHaveBeenCalled();
    expect(installButton(el).hasAttribute("disabled")).toBe(false);
  });

  it("flashes the image of the linked chip's family, fetched and parsed once linked", async () => {
    const fetch = stubUf2Download(new Uint8Array([7]));
    let image: unknown;
    mocks.runBeken.mockImplementation(async (_port, source) => {
      image = await source({ chip: "BK7252", family: "BK7251" });
      return { rebooted: true };
    });
    const el = await mountBkPrebuilt("BK7231N", "BK7251");
    const manifestReads = mocks.fetchEsphomeWebManifest.mock.calls.length;

    await el._flash();
    await el.updateComplete;

    expect(mocks.runBeken).toHaveBeenCalledWith(
      PORT,
      expect.any(Function),
      expect.any(Object)
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://firmware.esphome.io/esphome-web/26.10.0/esphome-web-bk7251.uf2",
      SIGNAL
    );
    // The manifest read on open is the one used.
    expect(mocks.fetchEsphomeWebManifest).toHaveBeenCalledTimes(manifestReads);
    expect(mocks.loadBekenImage).toHaveBeenCalledWith(new Uint8Array([7]));
    expect(image).toBe(IMAGE);
    expect(card(el).statusMessage).toBe("firmware.status_done web.bk.logs_elsewhere");
  });

  it.each([
    [{ chip: "BK7231Q", family: "BK7231Q" }, "web.install.prebuilt_no_image | BK7231Q"],
    // Published, but not listed in this manifest.
    [{ chip: "BK7238", family: "BK7238" }, "web.install.prebuilt_no_image | BK7238"],
    [{ chip: undefined, family: undefined }, "web.install.prebuilt_unknown_chip"],
  ])("names a linked chip without a published image (%o)", async (linked, line) => {
    const fetch = stubUf2Download();
    mocks.runBeken.mockImplementation(async (_port, source) => {
      try {
        await source(linked);
        return { rebooted: true };
      } catch (error) {
        return { detail: String(error), error };
      }
    });
    const el = await mountBkPrebuilt("BK7231N");
    el._localize = argsLocalize;

    await el._flash();
    await el.updateComplete;

    expect(fetch).not.toHaveBeenCalled();
    expect(card(el).state).toBe("error");
    expect(card(el).statusMessage).toBe(line);
    expect(card(el).statusDetail).toBe("");
  });

  it.each([
    [
      "does not parse",
      () => {
        stubUf2Download();
        mocks.loadBekenImage.mockResolvedValue({
          key: "firmware.bk_bad_uf2",
          detail: "no blocks",
        });
      },
      "firmware.bk_bad_uf2",
      "no blocks",
    ],
    [
      "does not download",
      () =>
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => ({ ok: false, status: 503 }))
        ),
      "web.install.prebuilt_download_failed",
      expect.stringMatching(/esphome-web-bk7251\.uf2 failed \(503\)/),
    ],
  ])(
    "names a published image that %s once linked as it would before the link",
    async (_n, given, title, detail) => {
      given();
      mocks.runBeken.mockImplementation(async (_port, source) => {
        try {
          await source({ chip: "BK7252", family: "BK7251" });
          return { rebooted: true };
        } catch (error) {
          return { detail: (error as Error).message, error };
        }
      });
      const el = await mountBkPrebuilt("BK7251");

      await el._flash();
      await el.updateComplete;

      expect(card(el).state).toBe("error");
      expect(card(el).statusMessage).toBe(title);
      expect(card(el).statusDetail).toEqual(detail);
    }
  );
});
