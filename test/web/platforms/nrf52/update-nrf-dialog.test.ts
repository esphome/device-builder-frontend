// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("../../../../src/components/process-terminal/process-terminal.js", () => ({}));
vi.mock("../../../../src/components/install-details-log.js", () => ({}));

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  pickBleDevice: vi.fn(),
  isWebBluetoothSupported: vi.fn(() => true),
  flashMcubootOverBle: vi.fn(),
  flashMcubootOverSerial: vi.fn(),
  loadSmpEngine: vi.fn(),
  loadRealSmpEngine: (): Promise<unknown> => Promise.reject(new Error("not loaded")),
}));
vi.mock("../../../../src/platforms/nrf52/index.js", async (importOriginal) => {
  const real = await importOriginal<{ loadSmpEngine(): Promise<unknown> }>();
  mocks.loadRealSmpEngine = real.loadSmpEngine;
  return { ...real, loadSmpEngine: mocks.loadSmpEngine };
});
vi.mock("../../../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../../../src/platforms/nrf52/ble-nus-picker.js", () => ({
  pickBleDevice: mocks.pickBleDevice,
}));
vi.mock("../../../../src/platforms/nrf52/ble-nus-stream.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isWebBluetoothSupported: mocks.isWebBluetoothSupported,
}));
vi.mock("../../../../src/platforms/nrf52/smp-engine.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  flashMcubootOverBle: mocks.flashMcubootOverBle,
  flashMcubootOverSerial: mocks.flashMcubootOverSerial,
}));

import { pickerText, pickFile, slowFile, watchFileInput } from "../../_pick-file.js";
import { identityLocalize, mount } from "../../../_dom.js";
import { lapsedPick } from "../../../_web-serial.js";
import { SMP_BLE_SERVICE_UUID } from "../../../../src/platforms/nrf52/smp-ble-service.js";
import {
  SmpBleServiceNotFoundError,
  SmpNoReplyError,
  SmpRestartNeededError,
  SmpSilentDeviceError,
} from "../../../../src/platforms/nrf52/smp-engine.js";
import { SerialDeviceLostError } from "../../../../src/util/serial-open-error.js";
import { ESPHomeWebUpdateNrfDialog } from "../../../../src/web/platforms/nrf52/esphome-web-update-nrf-dialog.js";
import { makeMcubootImage } from "../../../platforms/nrf52/_mcuboot-image.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const imageFile = (bytes: Uint8Array = makeMcubootImage()) =>
  new File([bytes as Uint8Array<ArrayBuffer>], "app_update.bin");

async function mountDialog(file: File | null = imageFile()): Promise<any> {
  const el = await mount(new ESPHomeWebUpdateNrfDialog(), {
    _localize: identityLocalize,
    open: true,
  } as Partial<ESPHomeWebUpdateNrfDialog>);
  if (file) await pickFile(el, "_image", file);
  return el;
}

const logLines = (el: any): string[] | undefined =>
  (el.shadowRoot!.querySelector("esphome-install-details-log") as any)?.lines;
const button = (el: any, id: string) =>
  el.shadowRoot!.querySelector(`#${id}`) as HTMLElement | null;
const disabled = (el: any, id: string) => button(el, id)!.hasAttribute("disabled");

const TRANSPORTS = [
  ["Bluetooth", "_updateOverBle", mocks.flashMcubootOverBle, { name: "itsy" }],
  ["serial", "_updateOverSerial", mocks.flashMcubootOverSerial, { port: true }],
] as const;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.loadSmpEngine.mockImplementation(() => mocks.loadRealSmpEngine());
  mocks.isWebBluetoothSupported.mockReturnValue(true);
  mocks.requestSerialPort.mockResolvedValue({ port: true });
  mocks.pickBleDevice.mockResolvedValue({ name: "itsy" });
  mocks.flashMcubootOverBle.mockResolvedValue(undefined);
  mocks.flashMcubootOverSerial.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.resetAllMocks();
  document.body.innerHTML = "";
});

describe.each(TRANSPORTS)(
  "esphome-web-update-nrf-dialog over %s",
  (_name, run, flash, target) => {
    it("sends the picked image to the picked device and reports progress", async () => {
      const el = await mountDialog();
      flash.mockImplementation(async (_target, _image, hooks) => {
        hooks.onLog?.("Checking device image status");
        hooks.onProgress(41.6);
        expect(el._state).toBe("flashing");
        expect(el._progress).toBe(42);
      });

      await el[run]();
      await el.updateComplete;

      expect(flash).toHaveBeenCalledWith(
        target,
        expect.objectContaining({ info: expect.objectContaining({ version: "1.2.3" }) }),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(el._state).toBe("success");
      expect(logLines(el)).toEqual(["Checking device image status"]);
    });

    it("asks for the device in the click itself, with nothing awaited before it", async () => {
      const el = await mountDialog();
      // Not awaited: the chooser has to be asked for before the click's turn ends.
      const update = el[run]();
      expect(
        mocks.pickBleDevice.mock.calls.length + mocks.requestSerialPort.mock.calls.length
      ).toBe(1);
      await update;
    });

    it("stays on the picker when the chooser is dismissed", async () => {
      mocks.pickBleDevice.mockResolvedValue(null);
      mocks.requestSerialPort.mockResolvedValue(null);
      const el = await mountDialog();

      await el[run]();

      expect(flash).not.toHaveBeenCalled();
      expect(el._state).toBe("idle");
      expect(el._pending).toBe(false);
    });

    it("does not start once the dialog closed under the chooser", async () => {
      const el = await mountDialog();
      let choose!: (picked: unknown) => void;
      const chooser = new Promise((resolve) => (choose = resolve));
      mocks.pickBleDevice.mockReturnValue(chooser);
      mocks.requestSerialPort.mockReturnValue(chooser);

      const update = el[run]();
      el.open = false;
      await el.updateComplete;
      choose(target);
      await update;

      expect(flash).not.toHaveBeenCalled();
      expect(el._state).toBe("idle");
    });

    it("does not start once the dialog closed while the tools loaded", async () => {
      const el = await mountDialog();
      let loaded!: () => void;
      mocks.loadSmpEngine.mockImplementation(async () => {
        await new Promise<void>((resolve) => (loaded = resolve));
        return mocks.loadRealSmpEngine();
      });

      const update = el[run]();
      await vi.waitFor(() => expect(el._state).toBe("flashing"));
      el.open = false;
      await el.updateComplete;
      loaded();
      await update;

      expect(flash).not.toHaveBeenCalled();
      expect(el._state).toBe("idle");
    });

    it("names a device that never answers as one without the serial transport", async () => {
      const el = await mountDialog();
      flash.mockRejectedValue(
        new SmpSilentDeviceError("SMP: no response from the device")
      );

      await el[run]();

      expect(el._state).toBe("error");
      // Over Bluetooth the service found says the transport is there.
      expect(el._errorMessage).toBe(
        run === "_updateOverSerial"
          ? "web.nrf.update_serial_no_reply"
          : "web.nrf.install_error_flash"
      );
    });

    it("asks for a restart when the reset could not be sent", async () => {
      const el = await mountDialog();
      flash.mockRejectedValue(new SmpRestartNeededError(new Error("write failed")));

      await el[run]();
      await el.updateComplete;

      // Not a failure to retry: the image is on the device.
      expect(el._state).toBe("restart");
      const card = el.shadowRoot!.querySelector("esphome-process-terminal") as any;
      expect(card.statusMessage).toBe("firmware.nrf_smp_restart_needed_title");
      expect(card.statusDetail).toBe("firmware.nrf_smp_restart_needed");
      expect(el.shadowRoot!.querySelector(".actions")!.textContent).toContain(
        "command.close"
      );
    });

    it("says so when the update tools cannot be loaded", async () => {
      const el = await mountDialog();
      mocks.loadSmpEngine.mockRejectedValue(new Error("chunk failed to load"));

      await el[run]();

      expect(flash).not.toHaveBeenCalled();
      expect(el._state).toBe("error");
      expect(el._errorMessage).toBe("web.install.tools_load_failed");
    });

    it("reports a device that stops answering part way with the engine's reason", async () => {
      const el = await mountDialog();
      const err = new SmpNoReplyError("SMP: no response from the device");
      flash.mockRejectedValue(err);

      await el[run]();

      expect(el._errorMessage).toBe("web.nrf.install_error_flash");
      expect(console.error).toHaveBeenCalledWith(expect.any(String), err);
    });

    it("reports any other failure with the engine's reason, and retries afresh", async () => {
      const el = await mountDialog();
      flash.mockImplementationOnce(async (_target, _image, hooks) => {
        hooks.onLog?.("first run");
        throw new Error("SMP: uploading failed (rc=5)");
      });

      await el[run]();
      await el.updateComplete;
      expect(el._state).toBe("error");
      expect(el._errorMessage).toBe("web.nrf.install_error_flash");

      el._state = "idle";
      await el[run]();
      await el.updateComplete;
      expect(el._state).toBe("success");
      expect(el._logLines).toEqual([]);
    });

    it("does nothing until an image is picked and checked", async () => {
      const el = await mountDialog(null);
      await el[run]();
      expect(mocks.pickBleDevice).not.toHaveBeenCalled();
      expect(mocks.requestSerialPort).not.toHaveBeenCalled();
    });

    it("drops the result of an update the dialog was closed under", async () => {
      const el = await mountDialog();
      let signal!: AbortSignal;
      flash.mockImplementation(async (_target, _image, hooks) => {
        signal = hooks.signal;
        el.open = false;
        await el.updateComplete;
        throw new Error("closed");
      });

      await el[run]();

      expect(signal.aborted).toBe(true);
      expect(el._state).toBe("idle");
      expect(el._errorMessage).toBe("");
    });
  }
);

describe("esphome-web-update-nrf-dialog", () => {
  it("asks the chooser for the devices that advertise the SMP service", async () => {
    const el = await mountDialog();
    await el._updateOverBle();
    expect(mocks.pickBleDevice).toHaveBeenCalledWith(
      identityLocalize,
      [],
      SMP_BLE_SERVICE_UUID,
      [SMP_BLE_SERVICE_UUID]
    );
  });

  it("says so when the picked device has no mcumgr service", async () => {
    const el = await mountDialog();
    mocks.flashMcubootOverBle.mockRejectedValue(new SmpBleServiceNotFoundError());

    await el._updateOverBle();

    expect(el._errorMessage).toBe("firmware.nrf_smp_ble_service_not_found");
  });

  it("says to click again for a port chooser refused after the click ran out", async () => {
    const el = await mountDialog();
    mocks.requestSerialPort.mockRejectedValue(lapsedPick());

    await el._updateOverSerial();

    expect(el._state).toBe("error");
    expect(el._errorMessage).toBe("serial.picker_needs_click");
    expect(mocks.flashMcubootOverSerial).not.toHaveBeenCalled();
  });

  it("offers Bluetooth only where the browser has it", async () => {
    mocks.isWebBluetoothSupported.mockReturnValue(false);
    const el = await mountDialog();
    expect(button(el, "btn-update-ble")).toBeNull();
    expect(button(el, "btn-update-serial")).not.toBeNull();
  });

  it("names an image that is not MCUboot's under the picker, when it is picked", async () => {
    const el = await mountDialog(imageFile(makeMcubootImage({ magic: 0xdeadbeef })));
    expect(el._state).toBe("idle");
    expect(pickerText(el)).toEqual({
      name: "web.nrf.install_file_placeholder",
      status: "",
      error: expect.stringContaining("firmware.nrf_bad_mcuboot_image: "),
    });
    await el._updateOverBle();
    expect(mocks.pickBleDevice).not.toHaveBeenCalled();
  });

  it("offers the update only once the picked image is read and checked", async () => {
    const slow = slowFile("app_update.bin");
    const el = await mountDialog(null);
    el._onFileChange({ target: { files: [slow.file] } });
    await el.updateComplete;
    expect(pickerText(el).status).toBe("web.install.preparing");
    expect(disabled(el, "btn-update-ble")).toBe(true);
    expect(disabled(el, "btn-update-serial")).toBe(true);

    slow.read(makeMcubootImage().buffer as ArrayBuffer);
    await vi.waitFor(() => expect(el._image.state.kind).toBe("ready"));
    await el.updateComplete;
    expect(disabled(el, "btn-update-ble")).toBe(false);
  });

  it("unpicks the image when the dialog closes, so it can be picked again", async () => {
    const el = await mountDialog();
    const cleared = watchFileInput(el);
    el.open = false;
    await el.updateComplete;
    expect(cleared).toHaveBeenCalledWith("");
    expect(el._file).toBeNull();
  });
});

describe("esphome-web-update-nrf-dialog over serial", () => {
  it("drops a chooser failure that lands after the dialog closed", async () => {
    const el = await mountDialog();
    let refuse!: (err: Error) => void;
    mocks.requestSerialPort.mockReturnValue(
      new Promise((_resolve, reject) => (refuse = reject))
    );

    const update = el._updateOverSerial();
    el.open = false;
    await el.updateComplete;
    refuse(new Error("no port"));
    await update;

    expect(el._state).toBe("idle");
    expect(el._errorMessage).toBe("");
  });

  const lost = new SerialDeviceLostError();

  it.each([
    ["a write", lost],
    ["the wait for a reply", new SmpNoReplyError(lost.message, lost)],
  ])("says the device disconnected when %s finds it gone", async (_name, err) => {
    const el = await mountDialog();
    mocks.flashMcubootOverSerial.mockRejectedValue(err);

    await el._updateOverSerial();

    expect(el._errorMessage).toBe("serial.device_lost");
  });
});
