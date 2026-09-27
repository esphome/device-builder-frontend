// @vitest-environment happy-dom
/**
 * The receiver runs the engine the firmware frame names, defaulting to
 * esptool for a frame from an older dashboard, and advertises its engines
 * on ready.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/util/web-serial.js", () => ({
  isPortPickerCancel: vi.fn(() => false),
  webSerialAvailability: vi.fn(() => "available"),
}));
vi.mock("../../src/web/dashboard/esphome-web-card.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("../../src/components/ansi-log.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));
vi.mock("../../src/web/logs/esphome-web-logs-dialog.js", () => ({}));
vi.mock("../../src/web/flash-receiver/live-log-port.js", () => ({
  openLiveLogPort: vi.fn(async () => ({ port: null, error: "none" })),
}));
const engines = vi.hoisted(() => {
  const make = (name: string) => ({
    name,
    logs: { reset: "rts-pulse" },
    validate: vi.fn(async (): Promise<string | null> => null),
    run: vi.fn(
      async (
        _port: unknown,
        _parts: unknown,
        _erase: boolean,
        hooks: { onState: (s: string, m: string) => void }
      ) => {
        hooks.onState("installing", `${name} writing`);
        return true;
      }
    ),
  });
  return { esp: make("esp"), rtl: make("rtl-ambz2") };
});
vi.mock("../../src/web/flash-receiver/receiver-engine.js", () => ({
  RECEIVER_ENGINES: {
    esp: async () => engines.esp,
    "rtl-ambz2": async () => engines.rtl,
  },
  RECEIVER_FLASHERS: ["esp", "rtl-ambz2"],
}));

import { ESPHomeWebFlashReceiver } from "../../src/web/flash-receiver/esphome-web-flash-receiver.js";
import { MSG_FIRMWARE, MSG_READY } from "../../src/web/flash-receiver/protocol.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const port = { getInfo: () => ({}) } as SerialPort;

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  delete (window as any).opener;
});

async function handOff(frame: Record<string, unknown>) {
  const opener = { postMessage: vi.fn() };
  Object.defineProperty(window, "opener", { value: opener, configurable: true });
  window.location.hash = "#nonce=n1";
  Object.defineProperty(navigator, "serial", {
    configurable: true,
    value: { requestPort: async () => port, getPorts: async () => [] },
  });
  const el = new ESPHomeWebFlashReceiver();
  (el as any)._localize = (k: string) => k;
  document.body.appendChild(el);
  await el.updateComplete;
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: MSG_FIRMWARE,
        nonce: "n1",
        parts: [{ address: 0, data: new ArrayBuffer(4) }],
        ...frame,
      },
      origin: "http://dashboard.local",
      source: opener as unknown as Window,
    })
  );
  await el.updateComplete;
  await (el as any)._onPrimary();
  return { el, opener };
}

describe("esphome-web-flash-receiver engines", () => {
  it("advertises its engines on ready", async () => {
    const { opener } = await handOff({});
    const ready = opener.postMessage.mock.calls
      .map((c) => c[0] as { type: string; flashers?: string[] })
      .find((m) => m.type === MSG_READY);
    expect(ready?.flashers).toEqual(["esp", "rtl-ambz2"]);
  });

  it("runs esptool for a frame without a flasher, as an older dashboard sends", async () => {
    await handOff({});
    expect(engines.esp.run).toHaveBeenCalledOnce();
    expect(engines.rtl.run).not.toHaveBeenCalled();
    expect(engines.esp.run.mock.calls[0][2]).toBe(true); // erase defaults on
  });

  it("runs the named engine and relays its states to the opener", async () => {
    const { opener } = await handOff({ flasher: "rtl-ambz2", erase: false });
    expect(engines.rtl.run).toHaveBeenCalledOnce();
    expect(engines.rtl.run.mock.calls[0][2]).toBe(false);
    const states = opener.postMessage.mock.calls
      .map((c) => c[0] as { type: string; state?: string; detail?: string })
      .filter((m) => m.type === "esphome-web-flash:state")
      .map((m) => `${m.state}:${m.detail}`);
    expect(states).toContain("installing:rtl-ambz2 writing");
    expect(states[states.length - 1]).toMatch(/^done:/);
  });

  it("shows the engine's reason when the image is not its kind", async () => {
    engines.rtl.validate.mockResolvedValueOnce("firmware.rtl_bad_uf2 (family)");
    const { el } = await handOff({ flasher: "rtl-ambz2" });
    expect((el as any)._state).toBe("error");
    expect((el as any)._statusMessage).toContain("firmware.rtl_bad_uf2");
    expect(engines.rtl.run).not.toHaveBeenCalled();
  });
});
