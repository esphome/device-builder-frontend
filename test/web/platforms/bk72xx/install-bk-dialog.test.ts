// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("../../../../src/components/process-terminal/process-terminal.js", () => ({}));
vi.mock("../../../../src/components/install-details-log.js", () => ({}));

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  loadBekenImage: vi.fn(),
  runBeken: vi.fn(),
}));
vi.mock("../../../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../../../src/platforms/bk72xx/index.js", () => ({
  loadBekenImage: mocks.loadBekenImage,
  loadBekenEngine: async () => ({}),
  runBeken: mocks.runBeken,
}));

import { pickerText, pickFile } from "../../_pick-file.js";
import { identityLocalize, mount } from "../../../_dom.js";
import { ESPHomeWebInstallBkDialog } from "../../../../src/web/platforms/bk72xx/esphome-web-install-bk-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const IMAGE = { familyId: 0x159ac324, board: "b", runs: [], totalBytes: 0 };
const PORT = { getInfo: () => ({}) } as unknown as SerialPort;
const uf2 = () => new File([new Uint8Array(8)], "firmware.uf2");

async function mountBare(): Promise<any> {
  return (await mount(new ESPHomeWebInstallBkDialog(), {
    _localize: identityLocalize,
    open: true,
  } as Partial<ESPHomeWebInstallBkDialog>)) as any;
}

async function mountDialog(): Promise<any> {
  const el = await mountBare();
  await pickFile(el, "_image", uf2());
  return el;
}

const card = (el: any) => el.shadowRoot!.querySelector("esphome-process-terminal") as any;
const guide = (el: any) => el.shadowRoot!.querySelector(".guide a") as HTMLAnchorElement;

beforeEach(() => {
  mocks.loadBekenImage.mockResolvedValue({ image: IMAGE });
  mocks.requestSerialPort.mockResolvedValue(PORT);
  mocks.runBeken.mockResolvedValue({ rebooted: true });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("esphome-web-install-bk-dialog", () => {
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
    expect(card(el).statusMessage).toBe("firmware.bk_done");
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
    const el = await mountBare();

    await pickFile(el, "_image", uf2());

    expect(pickerText(el).error).toBe("firmware.bk_wrong_family: family 0xe08f7564");
    expect(mocks.runBeken).not.toHaveBeenCalled();
  });
});
