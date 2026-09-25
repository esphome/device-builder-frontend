// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/web/dashboard/esphome-web-dashboard.js", () => ({}));
vi.mock("../../src/web/flash-receiver/esphome-web-flash-receiver.js", () => ({}));
vi.mock("../../src/web/header/esphome-web-header.js", () => ({}));
const notifyInfo = vi.fn();
vi.mock("../../src/util/notify.js", () => ({
  LONG_TOAST_DURATION_MS: 8000,
  notifyInfo: (...args: unknown[]) => notifyInfo(...args),
}));
const isRecentSerialActivity = vi.fn(() => false);
vi.mock("../../src/util/serial-reacquire.js", () => ({
  isRecentSerialActivity: () => isRecentSerialActivity(),
}));

import { ESPHomeWebApp } from "../../src/web/esphome-web-app.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const port = (usbVendorId: number, usbProductId: number) =>
  ({ getInfo: () => ({ usbVendorId, usbProductId }) }) as unknown as SerialPort;
const PICO = port(0x2e8a, 0xf00a);
const ESP = port(0x10c4, 0xea60);

let serialListeners: Record<string, (e: Event) => void>;

beforeEach(() => {
  serialListeners = {};
  Object.defineProperty(navigator, "serial", {
    configurable: true,
    value: {
      addEventListener: (type: string, fn: (e: Event) => void) => {
        serialListeners[type] = fn;
      },
      removeEventListener: () => {},
    },
  });
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  document.body.innerHTML = "";
  delete (navigator as any).serial;
  vi.clearAllMocks();
});

async function mount(): Promise<ESPHomeWebApp> {
  const el = new ESPHomeWebApp();
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const pick = (el: ESPHomeWebApp, p: SerialPort) =>
  el.dispatchEvent(new CustomEvent("port-picked", { detail: p, bubbles: true }));
const lastToast = () =>
  notifyInfo.mock.calls[notifyInfo.mock.calls.length - 1] as [
    string,
    { action: { label: string; onClick: () => void } },
  ];

describe("web app flow-switch suggestion", () => {
  it("offers the Pico flow when a picked port looks like a Pico, and switches on the action", async () => {
    const el = await mount();
    pick(el, PICO);
    expect(notifyInfo).toHaveBeenCalledTimes(1);
    const [message, options] = lastToast();
    expect(message).toBe("The connected device looks like a Raspberry Pi Pico.");
    expect(options.action.label).toBe("Switch to the Pico flow");
    options.action.onClick();
    await el.updateComplete;
    expect((el as any)._mode).toBe("pico");
    expect(window.location.search).toBe("?pico");
  });

  it("stays quiet for a port of the current family or an unknown one", async () => {
    const el = await mount();
    pick(el, ESP);
    pick(el, port(0x1366, 0x1015));
    expect(notifyInfo).not.toHaveBeenCalled();
  });

  it("offers the switch when an already-permitted device is plugged in", async () => {
    await mount();
    serialListeners.connect({ port: PICO } as unknown as Event);
    expect(lastToast()[0]).toBe("The connected device looks like a Raspberry Pi Pico.");
  });

  it("ignores a plug-in that is our own touch or flash re-enumerating", async () => {
    await mount();
    isRecentSerialActivity.mockReturnValue(true);
    serialListeners.connect({ port: PICO } as unknown as Event);
    expect(notifyInfo).not.toHaveBeenCalled();
  });
});
