import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BLE_NUS_SERVICE_UUID,
  bleNusLogsAvailable,
  BleNusServiceNotFoundError,
  BleUnavailableError,
  requestBleNusDevice,
  streamBleNus,
} from "../../src/util/ble-nus-stream.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const enc = (s: string) => new DataView(new TextEncoder().encode(s).buffer);

/** A NUS peripheral: scripts the connect outcome and lets tests push notifications. */
function fakeDevice(opts: { connectFailures?: number; noService?: boolean } = {}) {
  let failures = opts.connectFailures ?? 0;
  const charListeners = new Set<EventListener>();
  const deviceListeners = new Set<EventListener>();
  const char = {
    value: undefined as DataView | undefined,
    startNotifications: vi.fn(async () => char),
    stopNotifications: vi.fn(async () => char),
    addEventListener: (_t: string, l: EventListener) => charListeners.add(l),
    removeEventListener: (_t: string, l: EventListener) => charListeners.delete(l),
  };
  const service = { getCharacteristic: vi.fn(async () => char) };
  const noService = () => {
    throw new DOMException("No Services matching UUID", "NotFoundError");
  };
  const gatt = {
    connected: false,
    connect: vi.fn(async () => {
      if (failures > 0) {
        failures -= 1;
        throw new DOMException("GATT Error", "NetworkError");
      }
      gatt.connected = true;
      return gatt;
    }),
    disconnect: vi.fn(() => {
      gatt.connected = false;
    }),
    getPrimaryService: vi.fn(async (uuid: string) => {
      if (opts.noService || uuid !== BLE_NUS_SERVICE_UUID) noService();
      return service;
    }),
  };
  const device = {
    gatt,
    addEventListener: (_t: string, l: EventListener) => deviceListeners.add(l),
    removeEventListener: (_t: string, l: EventListener) => deviceListeners.delete(l),
  };
  return {
    device: device as unknown as BluetoothDevice,
    gatt,
    char,
    notify(text: string) {
      char.value = enc(text);
      for (const l of charListeners) l(new Event("characteristicvaluechanged"));
    },
    dropLink() {
      for (const l of deviceListeners) l(new Event("gattserverdisconnected"));
    },
    charListeners,
    deviceListeners,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("streamBleNus", () => {
  it("streams assembled lines with the serial formatting (timestamp, CR stripped)", async () => {
    const d = fakeDevice();
    const lines: string[] = [];
    const cancel = await streamBleNus(d.device, { onLine: (l) => lines.push(l) });
    d.notify("[I][app:1]: hel");
    d.notify("lo\r\n[D][x:2]: two\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\[\d\d:\d\d:\d\d\]/);
    expect(lines[0]).toContain("hello");
    expect(lines[0]).not.toContain("\r");
    // Chrome's cached subscription is cleared before subscribing again.
    expect(d.char.stopNotifications).toHaveBeenCalledOnce();
    expect(d.char.startNotifications).toHaveBeenCalledOnce();
    cancel();
    cancel(); // idempotent
    expect(d.gatt.disconnect).toHaveBeenCalledOnce();
    expect(d.charListeners.size).toBe(0);
    expect(d.deviceListeners.size).toBe(0);
  });

  it("reports a remote disconnect once and detaches", async () => {
    const d = fakeDevice();
    const onDisconnect = vi.fn();
    const cancel = await streamBleNus(d.device, { onLine: () => {}, onDisconnect });
    d.dropLink();
    d.dropLink();
    expect(onDisconnect).toHaveBeenCalledOnce();
    expect(d.charListeners.size).toBe(0);
    cancel(); // nothing left to do after the remote end went
    expect(d.gatt.disconnect).not.toHaveBeenCalled();
  });

  it("retries a failed connect up to the attempt budget", async () => {
    const d = fakeDevice({ connectFailures: 2 });
    const cancel = await streamBleNus(
      d.device,
      { onLine: () => {} },
      { attempts: 3, retryDelayMs: 0 }
    );
    expect(d.gatt.connect).toHaveBeenCalledTimes(3);
    cancel();
  });

  it("gives up after the last attempt, leaving nothing connected", async () => {
    const d = fakeDevice({ connectFailures: 5 });
    await expect(
      streamBleNus(d.device, { onLine: () => {} }, { attempts: 2, retryDelayMs: 0 })
    ).rejects.toMatchObject({ name: "NetworkError" });
    expect(d.gatt.connect).toHaveBeenCalledTimes(2);
  });

  it("never retries a device without the NUS service and drops the link", async () => {
    const d = fakeDevice({ noService: true });
    await expect(
      streamBleNus(d.device, { onLine: () => {} }, { attempts: 3, retryDelayMs: 0 })
    ).rejects.toBeInstanceOf(BleNusServiceNotFoundError);
    expect(d.gatt.connect).toHaveBeenCalledOnce();
    expect(d.gatt.disconnect).toHaveBeenCalledOnce();
  });

  it("stops retrying once the session moved on", async () => {
    const d = fakeDevice({ connectFailures: 5 });
    await expect(
      streamBleNus(
        d.device,
        { onLine: () => {} },
        { attempts: 3, retryDelayMs: 0, cancelled: () => true }
      )
    ).rejects.toMatchObject({ name: "NetworkError" });
    expect(d.gatt.connect).toHaveBeenCalledOnce();
  });

  it("retries a service lookup that failed for a reason other than a missing service", async () => {
    const d = fakeDevice();
    d.gatt.getPrimaryService.mockRejectedValueOnce(
      new DOMException("GATT", "NetworkError")
    );
    const cancel = await streamBleNus(
      d.device,
      { onLine: () => {} },
      { attempts: 2, retryDelayMs: 0 }
    );
    expect(d.gatt.connect).toHaveBeenCalledTimes(2);
    cancel();
  });

  it("fails the subscribe, not the stream, when the link drops before notifications flow", async () => {
    const d = fakeDevice();
    const onDisconnect = vi.fn();
    d.char.startNotifications.mockImplementationOnce(async () => {
      d.gatt.connected = false;
      d.dropLink();
      return d.char;
    });
    await expect(
      streamBleNus(d.device, { onLine: () => {}, onDisconnect })
    ).rejects.toMatchObject({
      name: "NetworkError",
    });
    expect(onDisconnect).not.toHaveBeenCalled();
    expect(d.deviceListeners.size).toBe(0);
  });

  it("removes the value listener when subscribing fails after it was added", async () => {
    const d = fakeDevice();
    d.char.startNotifications.mockRejectedValueOnce(new Error("busy"));
    await expect(streamBleNus(d.device, { onLine: () => {} })).rejects.toThrow("busy");
    expect(d.charListeners.size).toBe(0);
    expect(d.gatt.disconnect).toHaveBeenCalledOnce();
  });
});

describe("requestBleNusDevice", () => {
  const orig = Object.getOwnPropertyDescriptor(navigator, "bluetooth");
  afterEach(() => {
    if (orig) Object.defineProperty(navigator, "bluetooth", orig);
    else delete (navigator as any).bluetooth;
  });

  it("matches the given names and falls back to the service uuid", async () => {
    const picked = {};
    const requestDevice = vi.fn(async () => picked);
    Object.defineProperty(navigator, "bluetooth", {
      configurable: true,
      value: { requestDevice, getAvailability: async () => true },
    });
    await expect(
      requestBleNusDevice(["test3", "Living Room", "test3", ""])
    ).resolves.toBe(picked);
    expect(requestDevice).toHaveBeenCalledWith({
      filters: [
        { name: "test3" },
        { name: "Living Room" },
        { services: [BLE_NUS_SERVICE_UUID] },
      ],
      optionalServices: [BLE_NUS_SERVICE_UUID],
    });
  });

  it("tells an absent adapter apart from a dismissed chooser", async () => {
    Object.defineProperty(navigator, "bluetooth", {
      configurable: true,
      value: {
        requestDevice: vi.fn(async () => {
          throw new DOMException("User cancelled", "NotFoundError");
        }),
        getAvailability: async () => false,
      },
    });
    await expect(requestBleNusDevice(["x"])).rejects.toBeInstanceOf(BleUnavailableError);
    (navigator as any).bluetooth.getAvailability = async () => true;
    await expect(requestBleNusDevice(["x"])).resolves.toBeNull();
  });
});

describe("bleNusLogsAvailable", () => {
  const orig = Object.getOwnPropertyDescriptor(navigator, "bluetooth");
  afterEach(() => {
    if (orig) Object.defineProperty(navigator, "bluetooth", orig);
    else delete (navigator as any).bluetooth;
  });

  it("needs Web Bluetooth and an nRF52 target", () => {
    Object.defineProperty(navigator, "bluetooth", { configurable: true, value: {} });
    expect(bleNusLogsAvailable("nrf52")).toBe(true);
    expect(bleNusLogsAvailable("esp32")).toBe(false);
    delete (navigator as any).bluetooth;
    expect(bleNusLogsAvailable("nrf52")).toBe(false);
  });
});
