import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SMP_BLE_CHARACTERISTIC_UUID,
  SMP_BLE_SERVICE_UUID,
} from "../../../src/platforms/nrf52/smp-ble-service.js";
import {
  flashMcubootOverBle,
  SmpBleServiceNotFoundError,
} from "../../../src/platforms/nrf52/smp-ble.js";
import {
  IMG_MGMT_UPLOAD,
  parseMcubootImage,
} from "../../../src/platforms/nrf52/smp-protocol.js";
import { FakeSmpDevice } from "./_fake-smp-device.js";
import { makeMcubootImage } from "./_mcuboot-image.js";

/**
 * A BLE peripheral in front of a ``FakeSmpDevice``: reassembles the writes
 * into a frame by its length field, as mcumgr does, and notifies the reply
 * in pieces.
 */
function makePeripheral({
  smp = new FakeSmpDevice(),
  hasService = true,
  silent = false,
}: { smp?: FakeSmpDevice; hasService?: boolean; silent?: boolean } = {}) {
  const writes: number[] = [];
  let rx = new Uint8Array(0);
  const characteristic = Object.assign(new EventTarget(), {
    value: null as DataView | null,
    startNotifications: vi.fn(async () => {}),
    async writeValueWithoutResponse(buf: ArrayBuffer) {
      writes.push(buf.byteLength);
      const merged = new Uint8Array(rx.length + buf.byteLength);
      merged.set(rx);
      merged.set(new Uint8Array(buf), rx.length);
      rx = merged;
      if (rx.length < 8 || rx.length < 8 + ((rx[2] << 8) | rx[3])) return;
      const frame = rx;
      rx = new Uint8Array(0);
      if (silent) return;
      const reply = await smp.exchange(frame);
      for (let at = 0; at < reply.length; at += 20) {
        // Inside a larger buffer, as a notification's DataView can be.
        const padded = new Uint8Array(reply.length + 4);
        padded.set(reply, 4);
        characteristic.value = new DataView(
          padded.buffer,
          4 + at,
          Math.min(20, reply.length - at)
        );
        characteristic.dispatchEvent(new Event("characteristicvaluechanged"));
      }
    },
  });
  const disconnect = vi.fn();
  const device = Object.assign(new EventTarget(), {
    name: "kitchen",
    gatt: {
      disconnect,
      connect: async () => ({
        getPrimaryService: async (uuid: string) => {
          if (!hasService || uuid !== SMP_BLE_SERVICE_UUID) {
            throw new DOMException("no service", "NotFoundError");
          }
          return {
            getCharacteristic: async (id: string) => {
              expect(id).toBe(SMP_BLE_CHARACTERISTIC_UUID);
              return characteristic;
            },
          };
        },
      }),
    },
  });
  return {
    device: device as unknown as BluetoothDevice,
    drop: () => device.dispatchEvent(new Event("gattserverdisconnected")),
    smp,
    writes,
    disconnect,
  };
}

async function flash(
  peripheral: ReturnType<typeof makePeripheral>,
  bodySize = 300,
  signal?: AbortSignal
) {
  const image = await parseMcubootImage(makeMcubootImage({ bodySize }));
  const log: string[] = [];
  const done = flashMcubootOverBle(peripheral.device, image, {
    onProgress: () => {},
    onLog: (line) => log.push(line),
    signal,
  });
  done.catch(() => {});
  return { done, image, log };
}

describe("flashMcubootOverBle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uploads the image in small chunks and closes the link", async () => {
    // The fake reports no buffer size, as older firmware does.
    const peripheral = makePeripheral();
    const { done, image } = await flash(peripheral);
    await vi.runAllTimersAsync();
    await done;

    expect(peripheral.smp.received).toEqual(image.bytes);
    const chunks = peripheral.smp.requests.filter((r) => r.id === IMG_MGMT_UPLOAD);
    expect(chunks).toHaveLength(Math.ceil(image.bytes.length / 128));
    expect(peripheral.disconnect).toHaveBeenCalled();
  });

  it("sizes its chunks to the buffer the device reports", async () => {
    const smp = new FakeSmpDevice();
    smp.params = { buf_size: 2475, buf_count: 4 };
    const peripheral = makePeripheral({ smp });
    const { done } = await flash(peripheral, 5000);
    await vi.runAllTimersAsync();
    await done;

    const chunks = smp.requests.filter((r) => r.id === IMG_MGMT_UPLOAD);
    expect(chunks).toHaveLength(Math.ceil((5000 + 32 + 40) / (2475 - 78)));
    // A frame larger than one ATT packet goes out in MTU-sized writes.
    expect(Math.max(...peripheral.writes)).toBe(244);
  });

  it("stops at a cancel after the sequence number has wrapped", async () => {
    const smp = new FakeSmpDevice();
    const abort = new AbortController();
    smp.onUpload = (payload) => {
      // Past 256 exchanges, where a request reuses an earlier one's number.
      if ((payload.off as number) >= 300 * 128) abort.abort(new Error("cancelled"));
      return undefined;
    };
    const peripheral = makePeripheral({ smp });
    const { done, image } = await flash(peripheral, 60_000, abort.signal);
    await vi.runAllTimersAsync();

    await expect(done).rejects.toThrow("cancelled");
    expect(smp.received.length).toBeLessThan(image.bytes.length);
    expect(peripheral.disconnect).toHaveBeenCalled();
  });

  it("names a device without the SMP service", async () => {
    const peripheral = makePeripheral({ hasService: false });
    const { done } = await flash(peripheral);

    await expect(done).rejects.toBeInstanceOf(SmpBleServiceNotFoundError);
    expect(peripheral.disconnect).toHaveBeenCalled();
  });

  it("fails when the device never answers", async () => {
    const peripheral = makePeripheral({ silent: true });
    const { done } = await flash(peripheral);
    await vi.runAllTimersAsync();

    // The parameters query tolerates silence; the image state read does not.
    await expect(done).rejects.toThrow("no response from the device");
    expect(peripheral.disconnect).toHaveBeenCalled();
  });

  it("fails when the device disconnects mid-exchange", async () => {
    const peripheral = makePeripheral({ silent: true });
    const { done } = await flash(peripheral);
    await vi.advanceTimersByTimeAsync(10_000);
    peripheral.drop();

    await expect(done).rejects.toThrow("the device disconnected");
  });
});
