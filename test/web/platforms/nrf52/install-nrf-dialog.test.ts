// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("../../../../src/components/process-terminal/process-terminal.js", () => ({}));
vi.mock("../../../../src/components/install-details-log.js", () => ({}));

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  touchIntoBootloader: vi.fn(),
  parseDfuPackage: vi.fn(),
  flashDfuPackageWithReconnect: vi.fn(),
}));
vi.mock("../../../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../../../src/util/serial-bootloader-touch.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  touchIntoBootloader: mocks.touchIntoBootloader,
}));
vi.mock("../../../../src/platforms/nrf52/nrf-dfu.js", () => ({
  parseDfuPackage: mocks.parseDfuPackage,
  flashDfuPackageWithReconnect: mocks.flashDfuPackageWithReconnect,
}));

import { pickerText, pickFile, slowFile, watchFileInput } from "../../_pick-file.js";
import { identityLocalize, mount } from "../../../_dom.js";
import { ESPHomeWebInstallNrfDialog } from "../../../../src/web/platforms/nrf52/esphome-web-install-nrf-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function mountDialog(): Promise<any> {
  const el = await mount(new ESPHomeWebInstallNrfDialog(), {
    _localize: identityLocalize,
    open: true,
  } as Partial<ESPHomeWebInstallNrfDialog>);
  await pickFile(el, "_package", new File([new Uint8Array(4)], "firmware.zip"));
  return el;
}

const logLines = (el: any): string[] | undefined =>
  (el.shadowRoot!.querySelector("esphome-install-details-log") as any)?.lines;

beforeEach(() => {
  mocks.requestSerialPort.mockResolvedValue({});
  mocks.parseDfuPackage.mockReturnValue({ parts: [] });
  mocks.touchIntoBootloader.mockImplementation(async ({ onLog }) => {
    onLog?.("Touching the port at 1200 baud");
    return true;
  });
  mocks.flashDfuPackageWithReconnect.mockImplementation(async (_port, _pkg, hooks) => {
    hooks.onLog?.("Sending init packet");
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("esphome-web-install-nrf-dialog details log", () => {
  it("collects the touch's and the engine's step lines under the card", async () => {
    const el = await mountDialog();
    await el._startInstall();
    await el.updateComplete;
    expect(logLines(el)).toEqual(["Touching the port at 1200 baud"]);
    await el._continueFlash();
    await el.updateComplete;
    expect(el._state).toBe("success");
    expect(logLines(el)).toEqual([
      "Touching the port at 1200 baud",
      "Sending init packet",
    ]);
  });

  it("starts a retry with a fresh log without closing the dialog", async () => {
    const el = await mountDialog();
    mocks.flashDfuPackageWithReconnect.mockRejectedValue(new Error("no answer"));
    await el._startInstall();
    await el._continueFlash();
    await el.updateComplete;
    expect(el._state).toBe("error");
    el._state = "idle";
    await el._startInstall();
    await el.updateComplete;
    expect(logLines(el)).toEqual(["Touching the port at 1200 baud"]);
  });

  it("starts the next run with a fresh log", async () => {
    const el = await mountDialog();
    await el._startInstall();
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await pickFile(el, "_package", new File([new Uint8Array(4)], "firmware.zip"));
    await el._startInstall();
    await el.updateComplete;
    expect(logLines(el)).toEqual(["Touching the port at 1200 baud"]);
  });

  it("asks for the touch's port in the click itself, with nothing awaited before it", async () => {
    const el = await mountDialog();
    // Not awaited: the picker has to be asked for before the click's turn ends.
    const install = el._startInstall();
    expect(mocks.touchIntoBootloader).toHaveBeenCalledOnce();
    await install;
  });

  it("names a package that does not parse under the picker, when it is picked", async () => {
    mocks.parseDfuPackage.mockImplementation(() => {
      throw new Error("no manifest.json");
    });
    const el = await mountDialog();
    expect(el._state).toBe("idle");
    expect(pickerText(el)).toEqual({
      name: "web.nrf.install_file_placeholder",
      status: "",
      error: "firmware.nrf_bad_package: no manifest.json",
    });
    await el._startInstall();
    expect(mocks.touchIntoBootloader).not.toHaveBeenCalled();
  });

  it("unpicks the package when the dialog closes, so it can be picked again", async () => {
    const el = await mountDialog();
    const cleared = watchFileInput(el);
    el.open = false;
    await el.updateComplete;
    expect(cleared).toHaveBeenCalledWith("");
    expect(el._file).toBeNull();
  });

  it("offers the install only once the picked package is read and parsed", async () => {
    const slow = slowFile("firmware.zip");
    const el = (await mount(new ESPHomeWebInstallNrfDialog(), {
      _localize: identityLocalize,
      open: true,
    } as Partial<ESPHomeWebInstallNrfDialog>)) as any;
    const installDisabled = () =>
      el.shadowRoot!.querySelector(".actions wa-button").hasAttribute("disabled");
    el._onFileChange({ target: { files: [slow.file] } });
    await el.updateComplete;
    expect(pickerText(el).status).toBe("web.install.preparing");
    expect(installDisabled()).toBe(true);
    await el._startInstall();
    expect(mocks.touchIntoBootloader).not.toHaveBeenCalled();
    slow.read(new ArrayBuffer(4));
    await vi.waitFor(() => expect(installDisabled()).toBe(false));
  });
});
