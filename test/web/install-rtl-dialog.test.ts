// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("../../src/components/process-terminal/process-terminal.js", () => ({}));
vi.mock("../../src/components/install-details-log.js", () => ({}));

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  parseAmbz2Image: vi.fn(),
  flashAmbz2: vi.fn(),
}));
vi.mock("../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../src/util/libretiny-uf2.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  parseAmbz2Image: mocks.parseAmbz2Image,
}));
vi.mock("../../src/util/ambz2-flasher.js", () => ({ flashAmbz2: mocks.flashAmbz2 }));

import { identityLocalize, mount } from "../_dom.js";
import { Ambz2ImageError } from "../../src/util/libretiny-uf2.js";
import { ESPHomeWebInstallRtlDialog } from "../../src/web/install/esphome-web-install-rtl-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const IMAGE = { runs: [], totalBytes: 0 };
const PORT = { getInfo: () => ({}) } as unknown as SerialPort;

async function mountDialog(): Promise<any> {
  const el = (await mount(new ESPHomeWebInstallRtlDialog(), {
    _localize: identityLocalize,
    open: true,
  } as Partial<ESPHomeWebInstallRtlDialog>)) as any;
  el._file = new File([new Uint8Array(8)], "firmware.uf2");
  return el;
}

const card = (el: any) => el.shadowRoot!.querySelector("esphome-process-terminal") as any;
const log = (el: any) =>
  el.shadowRoot!.querySelector("esphome-install-details-log") as any;
const text = (el: any) => el.shadowRoot!.textContent ?? "";
const button = (el: any, label: string): HTMLElement =>
  [...el.shadowRoot!.querySelectorAll("wa-button")].find(
    (b: Element) => b.textContent?.trim() === label
  ) as HTMLElement;

beforeEach(() => {
  mocks.parseAmbz2Image.mockReturnValue(IMAGE);
  mocks.requestSerialPort.mockResolvedValue(PORT);
  mocks.flashAmbz2.mockResolvedValue(true);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("esphome-web-install-rtl-dialog", () => {
  it("flashes the parsed UF2 on the picked port, logging each step, and reports the reboot", async () => {
    mocks.flashAmbz2.mockImplementation(async (_port, _image, hooks) => {
      hooks.onLog?.("Resetting the board into download mode over DTR/RTS");
      hooks.onLinked?.();
      hooks.onProgress(50);
      return true;
    });
    const el = await mountDialog();
    await el._flash();
    await el.updateComplete;
    expect(mocks.flashAmbz2).toHaveBeenCalledWith(PORT, IMAGE, expect.any(Object));
    expect(card(el).state).toBe("success");
    expect(card(el).statusMessage).toBe("web.rtl.install_done");
    expect(log(el).lines).toEqual([
      "Resetting the board into download mode over DTR/RTS",
    ]);
  });

  it("tells the user to reset the board by hand when the adapter has no control lines", async () => {
    mocks.flashAmbz2.mockResolvedValue(false);
    const el = await mountDialog();
    await el._flash();
    await el.updateComplete;
    expect(card(el).statusMessage).toBe("firmware.rtl_done_manual_reset");
  });

  it("shows the strap guide while the engine waits for download mode", async () => {
    let strapped!: () => void;
    mocks.flashAmbz2.mockImplementation(async (_port, _image, hooks) => {
      hooks.onWaitingForStrap?.();
      await new Promise<void>((resolve) => (strapped = resolve));
      return true;
    });
    const el = await mountDialog();
    const pending = el._flash();
    await vi.waitFor(() =>
      expect(card(el).statusMessage).toBe("firmware.rtl_wait_title")
    );
    expect(card(el).state).toBeNull();
    expect(text(el)).toContain("firmware.rtl_guide_link");
    strapped();
    await pending;
    await el.updateComplete;
    expect(card(el).state).toBe("success");
  });

  it("refuses an AmebaZ image with the wrong-family copy and a bad file with the bad-file copy", async () => {
    mocks.parseAmbz2Image.mockImplementation(() => {
      throw new Ambz2ImageError(
        "firmware.rtl_wrong_family",
        new Error("family 0x22e0d6fc")
      );
    });
    const el = await mountDialog();
    await el._flash();
    await el.updateComplete;
    expect(card(el).state).toBe("error");
    expect(card(el).statusMessage).toBe("firmware.rtl_wrong_family");
    expect(card(el).statusDetail).toBe("family 0x22e0d6fc");
    expect(mocks.requestSerialPort).not.toHaveBeenCalled();

    button(el, "command.retry").click();
    await el.updateComplete;
    mocks.parseAmbz2Image.mockImplementation(() => {
      throw new Ambz2ImageError("firmware.rtl_bad_uf2", new Error("not a UF2"));
    });
    await el._flash();
    await el.updateComplete;
    expect(card(el).statusMessage).toBe("firmware.rtl_bad_uf2");
    expect(card(el).statusDetail).toBe("not a UF2");
  });

  it("goes back to the setup step when the picker is dismissed, and reports a failed flash", async () => {
    const el = await mountDialog();
    mocks.requestSerialPort.mockResolvedValue(null);
    await el._flash();
    await el.updateComplete;
    expect(card(el)).toBeNull();

    mocks.requestSerialPort.mockResolvedValue(PORT);
    mocks.flashAmbz2.mockRejectedValue(new Error("no answer from the ROM"));
    await el._flash();
    await el.updateComplete;
    expect(card(el).state).toBe("error");
    expect(card(el).statusMessage).toBe("firmware.rtl_flash_failed");
    expect(card(el).statusDetail).toBe("no answer from the ROM");
  });

  it("stops the engine and stays quiet when the dialog closes mid-flash", async () => {
    let signal!: AbortSignal;
    mocks.flashAmbz2.mockImplementation(
      (_port, _image, hooks) =>
        new Promise<boolean>((_resolve, reject) => {
          signal = hooks.signal!;
          signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })
    );
    const el = await mountDialog();
    const pending = el._flash();
    await vi.waitFor(() => expect(mocks.flashAmbz2).toHaveBeenCalled());
    el.open = false;
    await el.updateComplete;
    await pending;
    expect(signal.aborted).toBe(true);
    await el.updateComplete;
    expect(card(el)).toBeNull();
  });
});
