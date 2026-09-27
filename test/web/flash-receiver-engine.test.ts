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
  await settled(el);
  if (click) await (el as any)._onPrimary();
  return { el, opener };
}

// Waits out a preparation that is under way.
async function settled(el: ESPHomeWebFlashReceiver) {
  await vi.waitFor(() => expect((el as any)._preparation.pending).toBe(false));
  await el.updateComplete;
}

// A receiver opened by hand, with ``file`` as the picked one.
async function pickFile(file: { arrayBuffer: () => Promise<ArrayBuffer> }) {
  Object.defineProperty(window, "opener", { value: null, configurable: true });
  window.location.hash = "";
  Object.defineProperty(navigator, "serial", {
    configurable: true,
    value: { requestPort, getPorts: async () => [] },
  });
  const el = new ESPHomeWebFlashReceiver();
  (el as any)._localize = (k: string) => k;
  document.body.appendChild(el);
  await el.updateComplete;
  Object.defineProperty(el, "_fileInput", { value: { files: [file] } });
  await (el as any)._onFileChange();
  await settled(el);
  return el;
}

const primaryButton = (el: ESPHomeWebFlashReceiver) =>
  el.shadowRoot!.querySelector(".action-btn--primary") as HTMLButtonElement;

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
    const { el } = await handOff({ name: "fw.bin" }, false);
    expect((el as any)._state).toBe("error");
    expect(primaryButton(el).disabled).toBe(false);
    // The click that prepares again does not open the picker: the fetch may
    // use up its user activation.
    await (el as any)._onPrimary();
    expect(requestPort).not.toHaveBeenCalled();
    await settled(el);
    expect(engines.esp.prepare).toHaveBeenCalledTimes(2);
    expect((el as any)._state).toBe("connecting");
    expect((el as any)._statusMessage).toBe("web.flash.firmware_ready_named");
    await (el as any)._onPrimary();
    expect(engines.esp.prepare).toHaveBeenCalledTimes(2);
    expect(requestPort).toHaveBeenCalledOnce();
    expect(engines.esp.run).toHaveBeenCalledOnce();
    expect((el as any)._state).toBe("done");
  });

  it("offers the install only once the preparation has settled", async () => {
    let ready!: (plan: { run: typeof engines.esp.run }) => void;
    engines.esp.prepare.mockReturnValueOnce(
      new Promise((resolve) => {
        ready = resolve;
      })
    );
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
        },
        origin: "http://dashboard.local",
        source: opener as unknown as Window,
      })
    );
    await vi.waitFor(() => expect(engines.esp.prepare).toHaveBeenCalled());
    await el.updateComplete;
    // Still fetching and checking: no install, and a click starts nothing.
    expect((el as any)._statusMessage).toBe("web.flash.preparing");
    expect(primaryButton(el).disabled).toBe(true);
    await (el as any)._onPrimary();
    expect(requestPort).not.toHaveBeenCalled();

    ready({ run: engines.esp.run });
    await settled(el);
    expect(primaryButton(el).disabled).toBe(false);
    expect((el as any)._statusMessage).toBe("web.flash.firmware_ready");
  });

  it("asks for the port in the click itself, with nothing awaited before it", async () => {
    const { el } = await handOff({}, false);
    // Not awaited: the picker has to be asked for before the click's turn ends.
    const install = (el as any)._onPrimary();
    expect(requestPort).toHaveBeenCalledOnce();
    await install;
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

  it("prepares a picked file when it is picked, so the click opens the picker", async () => {
    const el = await pickFile({ arrayBuffer: async () => new ArrayBuffer(4) });
    expect(engines.esp.prepare).toHaveBeenCalledOnce();
    expect(engines.esp.prepare.mock.calls[0][1]).toBe(true); // a manual flash erases
    expect((el as any)._state).toBe("idle");
    expect(primaryButton(el).disabled).toBe(false);
    const install = (el as any)._onPrimary();
    expect(requestPort).toHaveBeenCalledOnce();
    await install;
    expect(engines.esp.run).toHaveBeenCalledOnce();
  });

  it("names a picked file that is not firmware when it is picked", async () => {
    engines.esp.prepare.mockResolvedValueOnce({ error: "web.flash.invalid_image" });
    const el = await pickFile({ arrayBuffer: async () => new ArrayBuffer(4) });
    expect((el as any)._state).toBe("error");
    expect((el as any)._statusMessage).toBe("web.flash.invalid_image");
    expect(requestPort).not.toHaveBeenCalled();
  });

  it("says so when the picked file cannot be read, and offers no install", async () => {
    const el = await pickFile({
      arrayBuffer: () => Promise.reject(new Error("NotReadableError")),
    });
    expect((el as any)._busy).toBe(false);
    expect((el as any)._state).toBe("error");
    expect((el as any)._statusMessage).toBe("web.flash.choose_file");
    expect(engines.esp.prepare).not.toHaveBeenCalled();
    expect(primaryButton(el).disabled).toBe(true);
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
