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
  type Hooks = {
    onState: (s: string, m: string) => void;
    onWaiting: (note: { message: string }) => void;
  };
  type Result = { rebooted: boolean; note?: { message: string } };
  const make = (name: string) => {
    const run = vi.fn(async (_port: unknown, hooks: Hooks): Promise<Result | null> => {
      hooks.onState("installing", `${name} writing`);
      return { rebooted: true };
    });
    return {
      logs: { reset: "rts-pulse" },
      run,
      prepare: vi.fn(
        async (
          _parts: unknown,
          _erase: boolean
        ): Promise<{ run: typeof run } | { error: string }> => ({ run })
      ),
    };
  };
  return { esp: make("esp"), rtl: make("rtl-ambz2") };
});
vi.mock("../../src/web/flash-receiver/receiver-engine.js", () => ({
  RECEIVER_ENGINES: {
    esp: async () => engines.esp,
    "rtl-ambz2": async () => engines.rtl,
  },
}));

import { ESPHomeWebFlashReceiver } from "../../src/web/flash-receiver/esphome-web-flash-receiver.js";
import { MSG_FIRMWARE, MSG_READY } from "../../src/web/flash-receiver/protocol.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const port = { getInfo: () => ({}), close: async () => {} } as unknown as SerialPort;

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  delete (window as any).opener;
});

const requestPort = vi.fn(async () => port);

async function handOff(frame: Record<string, unknown>, click = true) {
  const opener = { postMessage: vi.fn() };
  Object.defineProperty(window, "opener", { value: opener, configurable: true });
  window.location.hash = "#nonce=n1";
  Object.defineProperty(navigator, "serial", {
    configurable: true,
    value: { requestPort, getPorts: async () => [] },
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
  await (el as any)._prepared;
  await el.updateComplete;
  if (click) await (el as any)._onPrimary();
  return { el, opener };
}

const states = (opener: { postMessage: ReturnType<typeof vi.fn> }) =>
  opener.postMessage.mock.calls
    .map((c) => c[0] as { type: string; state?: string; detail?: string; note?: string })
    .filter((m) => m.type === "esphome-web-flash:state");

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
    expect(engines.rtl.prepare).not.toHaveBeenCalled();
    expect(engines.esp.prepare.mock.calls[0][1]).toBe(true); // erase defaults on
  });

  it("runs the named engine and relays its states to the opener", async () => {
    const { opener } = await handOff({ flasher: "rtl-ambz2", erase: false });
    expect(engines.rtl.run).toHaveBeenCalledOnce();
    expect(engines.rtl.prepare.mock.calls[0][1]).toBe(false);
    const seen = states(opener);
    expect(seen.map((m) => `${m.state}:${m.detail}`)).toContain(
      "installing:rtl-ambz2 writing"
    );
    expect(seen[seen.length - 1]).toMatchObject({ state: "done" });
    expect("note" in seen[seen.length - 1]).toBe(false);
  });

  it("names a bad image when the firmware arrives, before any port is asked for", async () => {
    // The click prepares once more; a bad image is still a bad image.
    const bad = { error: "firmware.rtl_bad_uf2 (family)" };
    engines.rtl.prepare.mockResolvedValueOnce(bad).mockResolvedValueOnce(bad);
    const { el } = await handOff({ flasher: "rtl-ambz2" }, false);
    expect((el as any)._state).toBe("error");
    expect((el as any)._statusMessage).toContain("firmware.rtl_bad_uf2");
    await (el as any)._onPrimary();
    expect(requestPort).not.toHaveBeenCalled();
    expect(engines.rtl.run).not.toHaveBeenCalled();
    expect((el as any)._busy).toBe(false);
  });

  it("names the image, not the network, when an engine throws while checking it", async () => {
    engines.esp.prepare.mockRejectedValueOnce(new Error("boom"));
    const { el } = await handOff({}, false);
    expect((el as any)._state).toBe("error");
    expect((el as any)._statusMessage).toBe("web.flash.invalid_image (boom)");
  });

  it("prepares again on the click after a preparation that failed", async () => {
    engines.esp.prepare.mockRejectedValueOnce(new Error("chunk fetch failed"));
    const { el } = await handOff({}, false);
    expect((el as any)._state).toBe("error");
    // The click that prepares again does not open the picker: the fetch may
    // have used up its user activation.
    await (el as any)._onPrimary();
    expect(engines.esp.prepare).toHaveBeenCalledTimes(2);
    expect(requestPort).not.toHaveBeenCalled();
    expect((el as any)._state).toBe("connecting");
    expect((el as any)._statusMessage).toBe("web.flash.firmware_ready");
    expect((el as any)._busy).toBe(false);
    await (el as any)._onPrimary();
    expect(engines.esp.prepare).toHaveBeenCalledTimes(2);
    expect(requestPort).toHaveBeenCalledOnce();
    expect(engines.esp.run).toHaveBeenCalledOnce();
    expect((el as any)._state).toBe("done");
    // Prepared once for good: a later click reuses the run.
    expect((el as any)._reprepare).toBeUndefined();
  });

  it("reports a frame naming a flasher it does not have as malformed", async () => {
    const { el } = await handOff({ flasher: "toString" }, false);
    expect((el as any)._state).toBe("error");
    expect((el as any)._statusMessage).toBe("web.flash.malformed");
    expect(engines.esp.prepare).not.toHaveBeenCalled();
  });

  it("takes one install for a double click", async () => {
    const { el } = await handOff({}, false);
    await Promise.all([(el as any)._onPrimary(), (el as any)._onPrimary()]);
    expect(requestPort).toHaveBeenCalledOnce();
    expect(engines.esp.run).toHaveBeenCalledOnce();
  });

  it("frees the button when the picked file cannot be read", async () => {
    Object.defineProperty(window, "opener", { value: null, configurable: true });
    window.location.hash = "";
    const el = new ESPHomeWebFlashReceiver();
    (el as any)._localize = (k: string) => k;
    document.body.appendChild(el);
    await el.updateComplete;
    Object.defineProperty(el, "_fileInput", {
      value: {
        files: [{ arrayBuffer: () => Promise.reject(new Error("NotReadableError")) }],
      },
    });
    await (el as any)._onPrimary();
    expect((el as any)._busy).toBe(false);
    expect((el as any)._state).toBe("error");
    expect(engines.esp.run).not.toHaveBeenCalled();
  });

  it("sends the manual reset as the done note and parks the port for Logs", async () => {
    engines.rtl.run.mockResolvedValueOnce({
      rebooted: false,
      note: { message: "firmware.rtl_done_manual_reset" },
    });
    const { el, opener } = await handOff({ flasher: "rtl-ambz2" });
    const seen = states(opener);
    expect(seen[seen.length - 1]).toMatchObject({
      state: "done",
      note: "firmware.rtl_done_manual_reset",
    });
    expect((el as any)._logPort).toBe(port);
    expect((el as any)._logsOpen).toBe(false);
  });

  it("relays the strap instruction to the dashboard while the engine waits", async () => {
    engines.rtl.run.mockImplementationOnce(async (_port, hooks) => {
      hooks.onState("connecting", "linking");
      hooks.onWaiting({ message: "firmware.rtl_wait_desc" });
      return null;
    });
    const { opener } = await handOff({ flasher: "rtl-ambz2" });
    expect(states(opener)).toContainEqual(
      expect.objectContaining({ state: "connecting", note: "firmware.rtl_wait_desc" })
    );
  });

  it("drops the handed-over bytes from the card's state once the run holds them", async () => {
    const { el } = await handOff({ name: "fw.uf2" }, false);
    expect((el as any)._firmware).toMatchObject({ name: "fw.uf2", parts: [] });
  });
});
