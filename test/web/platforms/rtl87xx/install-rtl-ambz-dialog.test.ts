// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("../../../../src/components/process-terminal/process-terminal.js", () => ({}));
vi.mock("../../../../src/components/install-details-log.js", () => ({}));

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  loadAmbzImage: vi.fn(),
  flashAmbz: vi.fn(),
}));
vi.mock("../../../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../../../src/platforms/rtl87xx/index.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadAmbzImage: mocks.loadAmbzImage,
}));
vi.mock("../../../../src/platforms/rtl87xx/ambz-flasher.js", () => ({
  flashAmbz: mocks.flashAmbz,
}));

import { pickFile } from "../../_pick-file.js";
import { identityLocalize, mount } from "../../../_dom.js";
import { ESPHomeWebInstallRtlAmbzDialog } from "../../../../src/web/platforms/rtl87xx/esphome-web-install-rtl-ambz-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const IMAGE = {
  ota1: { runs: [], totalBytes: 0 },
  ota2: { runs: [], totalBytes: 0 },
  ota2Offset: 0x80000,
};
const PORT = { getInfo: () => ({}) } as unknown as SerialPort;

async function mountDialog(): Promise<any> {
  const el = (await mount(new ESPHomeWebInstallRtlAmbzDialog(), {
    _localize: identityLocalize,
    open: true,
  } as Partial<ESPHomeWebInstallRtlAmbzDialog>)) as any;
  await pickFile(el, "_image", new File([new Uint8Array(8)], "firmware.uf2"));
  return el;
}

const card = (el: any) => el.shadowRoot!.querySelector("esphome-process-terminal") as any;
const text = (el: any) => el.shadowRoot!.textContent ?? "";

beforeEach(() => {
  mocks.loadAmbzImage.mockResolvedValue({ image: IMAGE });
  mocks.requestSerialPort.mockResolvedValue(PORT);
  mocks.flashAmbz.mockResolvedValue(false);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("esphome-web-install-rtl-ambz-dialog", () => {
  it("flashes the parsed image, both slots and all, on the picked port and asks for the reset", async () => {
    const el = await mountDialog();
    await el._flash();
    await el.updateComplete;
    expect(mocks.flashAmbz).toHaveBeenCalledWith(PORT, IMAGE, expect.any(Object));
    expect(card(el).state).toBe("success");
    expect(card(el).statusMessage).toBe("web.rtl_ambz.install_done_reset");
  });

  it("shows the TX2 strap guide while the engine waits for download mode", async () => {
    let strapped!: () => void;
    mocks.flashAmbz.mockImplementation(async (_port, _image, hooks) => {
      hooks.onWaiting?.();
      await new Promise<void>((resolve) => (strapped = resolve));
      return true;
    });
    const el = await mountDialog();
    const pending = el._flash();
    await vi.waitFor(() =>
      expect(card(el).statusMessage).toBe("firmware.rtl_wait_title")
    );
    expect(card(el).statusDetail).toBe("firmware.rtl_ambz_wait_desc");
    expect(text(el)).toContain("firmware.rtl_ambz_guide_link");
    strapped();
    await pending;
    await el.updateComplete;
    expect(card(el).state).toBe("success");
  });

  it("refuses an RTL8720C build before the port is asked for", async () => {
    mocks.loadAmbzImage.mockResolvedValue({
      key: "firmware.rtl_wrong_family",
      detail: "family 0xe08f7564",
    });
    const el = await mountDialog();
    await el.updateComplete;
    expect(text(el)).toContain("firmware.rtl_wrong_family");
    expect(mocks.requestSerialPort).not.toHaveBeenCalled();
  });
});
