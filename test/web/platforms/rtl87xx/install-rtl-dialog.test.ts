// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("../../../../src/components/process-terminal/process-terminal.js", () => ({}));
vi.mock("../../../../src/components/install-details-log.js", () => ({}));

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  parseAmbz2Image: vi.fn(),
  flashAmbz2: vi.fn(),
}));
vi.mock("../../../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../../../src/platforms/rtl87xx/libretiny-uf2.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  parseAmbz2Image: mocks.parseAmbz2Image,
}));
vi.mock("../../../../src/platforms/rtl87xx/ambz2-flasher.js", () => ({
  flashAmbz2: mocks.flashAmbz2,
}));
// The real parse, behind a seam a test can make fail as a chunk that did not load.
const seams = vi.hoisted(() => ({
  loadAmbz2Image: vi.fn(),
  real: undefined as undefined | ((bytes: Uint8Array) => Promise<unknown>),
}));
vi.mock("../../../../src/platforms/rtl87xx/index.js", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("../../../../src/platforms/rtl87xx/index.js")>();
  seams.real = real.loadAmbz2Image;
  return { ...real, loadAmbz2Image: seams.loadAmbz2Image };
});

import { pickFile } from "../../_pick-file.js";
import { identityLocalize, mount } from "../../../_dom.js";
import { Ambz2ImageError } from "../../../../src/platforms/rtl87xx/libretiny-uf2.js";
import { ESPHomeWebInstallRtlDialog } from "../../../../src/web/platforms/rtl87xx/esphome-web-install-rtl-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const IMAGE = { runs: [], totalBytes: 0 };
const PORT = { getInfo: () => ({}) } as unknown as SerialPort;

const uf2 = () => new File([new Uint8Array(8)], "firmware.uf2");

// A dialog with a UF2 picked, read and checked.
async function mountDialog(): Promise<any> {
  const el = (await mount(new ESPHomeWebInstallRtlDialog(), {
    _localize: identityLocalize,
    open: true,
  } as Partial<ESPHomeWebInstallRtlDialog>)) as any;
  await pickFile(el, "_image", uf2());
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
  seams.loadAmbz2Image.mockImplementation((bytes: Uint8Array) => seams.real!(bytes));
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
    // Giving up is allowed while waiting: the close aborts the engine.
    expect(el._busy).toBe(false);
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
    // Named when the file is picked, before any port is asked for.
    const el = await mountDialog();
    expect(card(el).state).toBe("error");
    expect(card(el).statusMessage).toBe("firmware.rtl_wrong_family");
    expect(card(el).statusDetail).toBe("family 0x22e0d6fc");
    expect(mocks.requestSerialPort).not.toHaveBeenCalled();

    // Back on the setup step the refused file is gone, and installs nothing.
    button(el, "command.retry").click();
    await el.updateComplete;
    expect(card(el)).toBeNull();
    expect(el._image.file).toBeNull();
    await el._flash();
    expect(mocks.requestSerialPort).not.toHaveBeenCalled();

    mocks.parseAmbz2Image.mockImplementation(() => {
      throw new Ambz2ImageError("firmware.rtl_bad_uf2", new Error("not a UF2"));
    });
    await pickFile(el, "_image", uf2());
    expect(card(el).statusMessage).toBe("firmware.rtl_bad_uf2");
    expect(card(el).statusDetail).toBe("not a UF2");
  });

  it("offers the install only once the picked file is read and checked", async () => {
    let read!: (bytes: ArrayBuffer) => void;
    const slow = {
      name: "firmware.uf2",
      arrayBuffer: () => new Promise<ArrayBuffer>((resolve) => (read = resolve)),
    } as unknown as File;
    const el = (await mount(new ESPHomeWebInstallRtlDialog(), {
      _localize: identityLocalize,
      open: true,
    } as Partial<ESPHomeWebInstallRtlDialog>)) as any;
    const installDisabled = () =>
      button(el, "firmware.browser_flash_action").hasAttribute("disabled");
    expect(installDisabled()).toBe(true);

    el._onFileChange({ target: { files: [slow] } });
    await el.updateComplete;
    expect(text(el)).toContain("web.install.preparing");
    expect(installDisabled()).toBe(true);
    await el._flash();
    expect(mocks.requestSerialPort).not.toHaveBeenCalled();

    read(new ArrayBuffer(8));
    await vi.waitFor(() => expect(el._image.state.kind).toBe("ready"));
    await el.updateComplete;
    expect(text(el)).not.toContain("web.install.preparing");
    expect(installDisabled()).toBe(false);
  });

  it("asks for the port in the click itself, with nothing awaited before it", async () => {
    const el = await mountDialog();
    // Not awaited: the picker has to be asked for before the click's turn ends.
    const install = el._flash();
    expect(mocks.requestSerialPort).toHaveBeenCalledOnce();
    await install;
  });

  it("never installs a file that another pick overtook", async () => {
    let first!: (bytes: ArrayBuffer) => void;
    const slow = {
      name: "old.uf2",
      arrayBuffer: () => new Promise<ArrayBuffer>((resolve) => (first = resolve)),
    } as unknown as File;
    const el = (await mount(new ESPHomeWebInstallRtlDialog(), {
      _localize: identityLocalize,
      open: true,
    } as Partial<ESPHomeWebInstallRtlDialog>)) as any;
    el._onFileChange({ target: { files: [slow] } });
    const newer = { runs: [], totalBytes: 1 };
    mocks.parseAmbz2Image.mockReturnValue(newer);
    await pickFile(el, "_image", new File([new Uint8Array(8)], "new.uf2"));
    // The first read ends now, with another image; it must not replace the newer one.
    mocks.parseAmbz2Image.mockReturnValue(IMAGE);
    first(new ArrayBuffer(8));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(el._image.state).toMatchObject({ kind: "ready", value: newer });
    expect(el._image.file.name).toBe("new.uf2");
  });

  it("checks the same file again after the parser did not load", async () => {
    seams.loadAmbz2Image.mockResolvedValueOnce({
      key: "firmware.engine_load_failed",
      detail: "Failed to fetch",
    });
    const el = await mountDialog();
    expect(card(el).statusMessage).toBe("firmware.engine_load_failed");
    button(el, "command.retry").click();
    await vi.waitFor(() => expect(el._image.state.kind).toBe("ready"));
    expect(el._image.file.name).toBe("firmware.uf2");
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

  it("ignores a run that finishes after the dialog closed", async () => {
    let finish!: () => void;
    mocks.flashAmbz2.mockImplementation(async (_port, _image, hooks) => {
      await new Promise<void>((resolve) => (finish = resolve));
      hooks.onLog?.("late line");
      return true;
    });
    const el = await mountDialog();
    const pending = el._flash();
    await vi.waitFor(() => expect(mocks.flashAmbz2).toHaveBeenCalled());
    el.open = false;
    await el.updateComplete;
    finish();
    await pending;
    await el.updateComplete;
    expect(card(el)).toBeNull();
    expect(el._logLines).toEqual([]);
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
