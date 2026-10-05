// @vitest-environment happy-dom
/**
 * The receiver runs the engine the firmware frame names, defaulting to
 * esptool for a frame from an older dashboard, and advertises its engines
 * on ready.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/util/web-serial.js")>()),
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
    onState: (s: "connecting" | "installing" | "done" | "error", m: string) => void;
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
          _erase: boolean,
          _logs?: string
        ): Promise<{ run: typeof run } | { error: string; retryable?: boolean }> => ({
          run,
        })
      ),
    };
  };
  const esp = make("esp");
  const rtl = make("rtl-ambz2");
  // An engine that picks its own device, with a step ahead of the install.
  const pico = {
    logs: { reset: "none" },
    before: vi.fn(async (hooks: Hooks): Promise<"dismissed" | null> => {
      hooks.onState("connecting", "resetting");
      hooks.onWaiting({ message: "now in BOOTSEL" });
      return null;
    }),
    run: vi.fn(
      async (
        hooks: Hooks
      ): Promise<{ message?: string; note?: Result["note"] } | "dismissed" | null> => {
        hooks.onState("installing", "pico writing");
        return {};
      }
    ),
  };
  // The lazy chunk loads; a test makes one reject to stand for a failed fetch.
  const load = { esp: vi.fn(async () => esp), rtl: vi.fn(async () => rtl) };
  return { esp, rtl, pico, load };
});
vi.mock("../../src/web/flash-receiver/receiver-engine.js", async () => {
  // Both write over one serial port, picked by the helper as the real ones do.
  const { serialRun } = await import("../../src/web/flash-receiver/serial-run.js");
  type Engine = typeof engines.esp;
  const picking = async (engine: Promise<Engine>) => {
    const { prepare, logs } = await engine;
    return {
      logs,
      prepare: async (
        parts: unknown,
        erase: boolean,
        _localize: unknown,
        logs?: string
      ) => {
        const plan = await prepare(parts, erase, logs);
        return "run" in plan ? { run: serialRun((k) => k, plan.run) } : plan;
      },
    };
  };
  return {
    RECEIVER_ENGINES: {
      esp: () => picking(engines.load.esp()),
      "rtl-ambz2": () => picking(engines.load.rtl()),
      "rp2-picoboot": async () => ({
        logs: engines.pico.logs,
        prepare: async () => ({
          run: engines.pico.run,
          before: { label: "Reset Device", run: engines.pico.before },
          hint: "put the Pico into BOOTSEL",
          primaryLabel: "Flash",
        }),
      }),
    },
  };
});

import { pickerRefused, withUserActivation } from "../_web-serial.js";
import { ESPHomeWebFlashReceiver } from "../../src/web/flash-receiver/esphome-web-flash-receiver.js";
import { MSG_FIRMWARE, MSG_READY } from "../../src/web/flash-receiver/protocol.js";
import { last } from "./_receiver-hooks.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const port = { getInfo: () => ({}), close: async () => {} } as unknown as SerialPort;

let restoreActivation = (): void => {};

afterEach(() => {
  restoreActivation();
  restoreActivation = () => {};
  document.body.innerHTML = "";
  vi.clearAllMocks();
  delete (window as any).opener;
});

const requestPort = vi.fn(async () => port);

// A receiver page: opened by a dashboard when ``opener`` is given, else by hand.
async function mountReceiver(opener: { postMessage: ReturnType<typeof vi.fn> } | null) {
  Object.defineProperty(window, "opener", { value: opener, configurable: true });
  window.location.hash = opener ? "#nonce=n1" : "";
  Object.defineProperty(navigator, "serial", {
    configurable: true,
    value: { requestPort, getPorts: async () => [] },
  });
  const el = new ESPHomeWebFlashReceiver();
  (el as any)._localize = (k: string) => k;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

// Hands ``frame`` over and, unless told not to, waits for it to be prepared
// and clicks the install.
async function handOff(frame: Record<string, unknown>, click = true, settle = true) {
  const opener = { postMessage: vi.fn() };
  const el = await mountReceiver(opener);
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
  if (!settle) return { el, opener };
  await settled(el);
  if (click) await (el as any)._onPrimary();
  return { el, opener };
}

const preparation = (el: ESPHomeWebFlashReceiver): string =>
  (el as any)._preparation.state.kind;

// Waits out a preparation that is under way.
async function settled(el: ESPHomeWebFlashReceiver) {
  await vi.waitFor(() => expect(preparation(el)).not.toBe("pending"));
  await el.updateComplete;
}

// A receiver opened by hand, with ``file`` as the picked one.
async function pickFile(file: { arrayBuffer: () => Promise<ArrayBuffer> }) {
  const el = await mountReceiver(null);
  Object.defineProperty(el, "_fileInput", {
    value: { files: [file], value: "C:\\fakepath\\firmware.bin" },
  });
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
    expect(ready?.flashers).toEqual([
      "esp",
      "rtl-ambz2",
      "rp2-picoboot",
      "nrf-dfu",
      "bk-uart",
      "ln-uart",
      "rtl-ambz",
    ]);
  });

  it("runs esptool for a frame without a flasher, as an older dashboard sends", async () => {
    await handOff({});
    expect(engines.esp.run).toHaveBeenCalledOnce();
    expect(engines.rtl.prepare).not.toHaveBeenCalled();
    expect(engines.esp.prepare.mock.calls[0][1]).toBe(true); // erase defaults on
    expect(engines.esp.prepare.mock.calls[0][2]).toBeUndefined();
  });

  it.each([
    { sent: "flash-port", passed: "flash-port" },
    { sent: "off", passed: "off" },
    { sent: "somewhere", passed: undefined },
  ])("passes on where the logs are: $sent as $passed", async ({ sent, passed }) => {
    await handOff({ flasher: "rtl-ambz2", logs: sent });
    expect(engines.rtl.prepare.mock.calls[0][2]).toBe(passed);
  });

  it.each([
    { sent: 9600, kept: 9600 },
    { sent: undefined, kept: 115200 },
    { sent: "fast", kept: 115200 },
  ])(
    "keeps the logs baud $kept for a hand-off that sent $sent",
    async ({ sent, kept }) => {
      const { el } = await handOff({ logBaudRate: sent }, false);
      expect((el as any)._logBaudRate).toBe(kept);
    }
  );

  it("goes back to the default baud for a file picked after a hand-off", async () => {
    const { el } = await handOff({ logBaudRate: 9600 }, false);
    Object.defineProperty(el, "_fileInput", {
      value: { files: [{ arrayBuffer: async () => new ArrayBuffer(4) }], value: "" },
    });
    await (el as any)._onFileChange();
    await settled(el);
    expect((el as any)._logBaudRate).toBe(115200);
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

  it("names a bad image when the firmware arrives, and offers no install for it", async () => {
    engines.rtl.prepare.mockResolvedValueOnce({ error: "firmware.rtl_bad_uf2 (family)" });
    const { el } = await handOff({ flasher: "rtl-ambz2" }, false);
    expect((el as any)._state).toBe("error");
    expect((el as any)._statusMessage).toContain("firmware.rtl_bad_uf2");
    // The same bytes would fail the same check: nothing to try again.
    expect(preparation(el)).toBe("idle");
    expect(primaryButton(el).disabled).toBe(true);
    await (el as any)._onPrimary();
    expect(engines.rtl.prepare).toHaveBeenCalledOnce();
    expect(requestPort).not.toHaveBeenCalled();
    expect((el as any)._busy).toBe(false);
    // The click changed nothing: the card still names the bad image.
    expect((el as any)._state).toBe("error");
    expect((el as any)._statusMessage).toContain("firmware.rtl_bad_uf2");
  });

  it("checks the image again after a chunk its check needs did not load", async () => {
    engines.rtl.prepare.mockResolvedValueOnce({
      error: "firmware.engine_load_failed (Failed to fetch)",
      retryable: true,
    });
    const { el } = await handOff({ flasher: "rtl-ambz2" }, false);
    expect((el as any)._state).toBe("error");
    expect(preparation(el)).toBe("retryable");
    expect(primaryButton(el).disabled).toBe(false);
    await (el as any)._onPrimary();
    await settled(el);
    expect(engines.rtl.prepare).toHaveBeenCalledTimes(2);
    expect(preparation(el)).toBe("ready");
  });

  it("leaves a newer pick's status alone when an overtaken file fails to read", async () => {
    let failFirst!: (err: Error) => void;
    const el = await mountReceiver(null);
    const files = [
      {
        arrayBuffer: () =>
          new Promise<ArrayBuffer>((_resolve, reject) => {
            failFirst = reject;
          }),
      },
    ];
    Object.defineProperty(el, "_fileInput", { value: { files } });
    const firstPick = (el as any)._onFileChange();
    files[0] = { arrayBuffer: async () => new ArrayBuffer(8) };
    await (el as any)._onFileChange();
    await settled(el);
    failFirst(new Error("NotReadableError"));
    await firstPick;
    expect(preparation(el)).toBe("ready");
    expect((el as any)._state).toBe("idle");
  });

  it("names the image, not the network, when an engine throws while checking it", async () => {
    engines.esp.prepare.mockRejectedValueOnce(new Error("boom"));
    const { el } = await handOff({}, false);
    expect((el as any)._state).toBe("error");
    expect((el as any)._statusMessage).toBe("web.flash.invalid_image (boom)");
  });

  it("loads the engine again on the click after a load that failed", async () => {
    // The page's warm-up and the preparation both miss the chunk.
    const offline = new TypeError("Failed to fetch");
    engines.load.esp.mockRejectedValueOnce(offline).mockRejectedValueOnce(offline);
    const { el } = await handOff({ name: "fw.bin" }, false);
    expect((el as any)._state).toBe("error");
    expect((el as any)._statusMessage).toBe("web.install.tools_load_failed");
    expect(preparation(el)).toBe("retryable");
    expect(primaryButton(el).disabled).toBe(false);
    // The button says what the click does: it loads again, it does not install.
    expect(primaryButton(el).textContent?.trim()).toBe("command.retry");
    // The click that loads again does not open the picker: the fetch may
    // use up its user activation.
    await (el as any)._onPrimary();
    expect(requestPort).not.toHaveBeenCalled();
    await settled(el);
    expect(engines.load.esp).toHaveBeenCalledTimes(3);
    expect((el as any)._state).toBe("connecting");
    expect((el as any)._statusMessage).toBe("web.flash.firmware_ready_named");
    expect(primaryButton(el).textContent?.trim()).toBe("web.flash.connect_install");
    await (el as any)._onPrimary();
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
    const { el } = await handOff({}, false, false);
    await vi.waitFor(() => expect(engines.esp.prepare).toHaveBeenCalled());
    await el.updateComplete;
    // Still fetching and checking: no install, and a click starts nothing.
    expect((el as any)._statusMessage).toBe("web.install.preparing");
    expect(primaryButton(el).disabled).toBe(true);
    await (el as any)._onPrimary();
    expect(requestPort).not.toHaveBeenCalled();

    ready({ run: engines.esp.run });
    await settled(el);
    expect(primaryButton(el).disabled).toBe(false);
    expect((el as any)._statusMessage).toBe("web.flash.firmware_ready");
  });

  it("keeps the firmware's name on the ready line after a dismissed picker", async () => {
    requestPort.mockRejectedValueOnce(new DOMException("dismissed", "NotFoundError"));
    const { el } = await handOff({ name: "fw.bin" });
    expect((el as any)._statusMessage).toBe("web.flash.firmware_ready_named");
  });

  it("says to click again for a picker refused after the click ran out", async () => {
    restoreActivation = withUserActivation(false);
    requestPort.mockRejectedValueOnce(pickerRefused());
    const { el } = await handOff({});
    expect((el as any)._state).toBe("error");
    expect((el as any)._statusMessage).toBe("serial.picker_needs_click");

    requestPort.mockRejectedValueOnce(new Error("no serial"));
    await (el as any)._onPrimary();
    expect((el as any)._statusMessage).toBe("web.flash.no_port");
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

  it("never offers the install of a file that another pick overtook", async () => {
    let first!: (plan: { run: typeof engines.esp.run }) => void;
    engines.esp.prepare
      .mockReturnValueOnce(
        new Promise((resolve) => {
          first = resolve;
        })
      )
      .mockResolvedValueOnce({ error: "web.flash.invalid_image" });
    const el = await mountReceiver(null);
    const files = [{ arrayBuffer: async () => new ArrayBuffer(4) }];
    Object.defineProperty(el, "_fileInput", { value: { files } });
    await (el as any)._onFileChange();
    // A second pick, of a file that is not firmware, while the first is checked.
    files[0] = { arrayBuffer: async () => new ArrayBuffer(8) };
    await (el as any)._onFileChange();
    await settled(el);
    // The first file's check ends now; it must not come back as ready.
    first({ run: engines.esp.run });
    await Promise.resolve();
    await el.updateComplete;
    expect(preparation(el)).toBe("idle");
    expect((el as any)._statusMessage).toBe("web.flash.invalid_image");
    expect(primaryButton(el).disabled).toBe(true);
  });

  it("says it is preparing while a picked file is still being read", async () => {
    let read!: (bytes: ArrayBuffer) => void;
    const el = await mountReceiver(null);
    const file = {
      arrayBuffer: () =>
        new Promise<ArrayBuffer>((resolve) => {
          read = resolve;
        }),
    };
    Object.defineProperty(el, "_fileInput", { value: { files: [file] } });
    const picked = (el as any)._onFileChange();
    await el.updateComplete;
    expect((el as any)._statusMessage).toBe("web.install.preparing");
    // The read is part of the work: the line comes with its spinner.
    expect(preparation(el)).toBe("pending");
    expect(el.shadowRoot!.querySelector(".status wa-spinner")).not.toBeNull();
    expect(primaryButton(el).disabled).toBe(true);
    expect(engines.esp.prepare).not.toHaveBeenCalled();
    read(new ArrayBuffer(4));
    await picked;
    await settled(el);
    expect(primaryButton(el).disabled).toBe(false);
  });

  it("names a picked file that is not firmware when it is picked", async () => {
    engines.esp.prepare.mockResolvedValueOnce({ error: "web.flash.invalid_image" });
    const el = await pickFile({ arrayBuffer: async () => new ArrayBuffer(4) });
    expect((el as any)._state).toBe("error");
    expect((el as any)._statusMessage).toBe("web.flash.invalid_image");
    expect(requestPort).not.toHaveBeenCalled();
    expect((el as any)._fileInput.value).toBe("");
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
    // Unpicked, so picking the same file again fires a change.
    expect((el as any)._fileInput.value).toBe("");
  });

  it("keeps a file picked while it is ready or can be checked again", async () => {
    const ready = await pickFile({ arrayBuffer: async () => new ArrayBuffer(4) });
    expect((ready as any)._fileInput.value).not.toBe("");
    document.body.innerHTML = "";
    const offline = new TypeError("Failed to fetch");
    engines.load.esp.mockRejectedValueOnce(offline).mockRejectedValueOnce(offline);
    const retryable = await pickFile({ arrayBuffer: async () => new ArrayBuffer(4) });
    expect(preparation(retryable)).toBe("retryable");
    expect((retryable as any)._fileInput.value).not.toBe("");
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

  it("opens no logs and parks no port for a device the opener says has none", async () => {
    engines.rtl.run.mockResolvedValueOnce({ rebooted: false });
    const { el } = await handOff({ flasher: "rtl-ambz2", logs: "off" });
    expect((el as any)._flashDone).toBe(true);
    expect((el as any)._logPort).toBeUndefined();
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

  describe("an engine that picks its own device", () => {
    const beforeButton = (el: ESPHomeWebFlashReceiver) =>
      el.shadowRoot!.querySelector("#btn-before") as HTMLButtonElement | null;
    const pico = { flasher: "rp2-picoboot", erase: false };

    it("shows the engine's hint, label and step, and none of them for the others", async () => {
      const { el } = await handOff(pico, false);
      expect(el.shadowRoot!.querySelector(".hint")!.textContent).toBe(
        "put the Pico into BOOTSEL"
      );
      expect(primaryButton(el).textContent!.trim()).toBe("Flash");
      expect(beforeButton(el)!.textContent!.trim()).toBe("Reset Device");

      document.body.innerHTML = "";
      const esp = (await handOff({}, false)).el;
      expect(beforeButton(esp)).toBeNull();
      expect(primaryButton(esp).textContent!.trim()).toBe("web.flash.connect_install");
    });

    it("runs the step from its own click and relays what the board needs next", async () => {
      const { el, opener } = await handOff(pico, false);
      beforeButton(el)!.click();
      await vi.waitFor(() => expect((el as any)._busy).toBe(false));

      expect(engines.pico.before).toHaveBeenCalledOnce();
      expect(engines.pico.run).not.toHaveBeenCalled();
      expect(states(opener)).toContainEqual(
        expect.objectContaining({ state: "connecting", note: "now in BOOTSEL" })
      );
      // The install is still offered, on a click of its own.
      await el.updateComplete;
      expect(primaryButton(el).disabled).toBe(false);
    });

    it("goes back to the ready line when the step's chooser is dismissed", async () => {
      engines.pico.before.mockImplementationOnce(async (hooks) => {
        hooks.onState("connecting", "resetting");
        return "dismissed";
      });
      const { el, opener } = await handOff({ ...pico, name: "fw.uf2" }, false);
      await (el as any)._onBefore();
      expect((el as any)._statusMessage).toBe("web.flash.firmware_ready_named");
      // The opener mirrors the receiver, so it is told as well.
      expect(last(states(opener))).toMatchObject({
        state: "connecting",
        detail: "web.flash.firmware_ready_named",
      });
    });

    it("asks no serial port for the install, and follows no logs without one", async () => {
      const { el, opener } = await handOff(pico);
      expect(engines.pico.run).toHaveBeenCalledOnce();
      expect(requestPort).not.toHaveBeenCalled();
      expect(last(states(opener))).toMatchObject({ state: "done" });
      expect((el as any)._logPort).toBeUndefined();
      expect((el as any)._logsOpen).toBe(false);
      await el.updateComplete;
      expect(beforeButton(el)).toBeNull();
    });

    it("finishes on the engine's own line when the finish is not an install", async () => {
      engines.pico.run.mockResolvedValueOnce({
        message: "UF2 downloaded",
        note: { message: "copy it to the drive" },
      });
      const { opener } = await handOff(pico);
      expect(last(states(opener))).toMatchObject({
        state: "done",
        detail: "UF2 downloaded",
        note: "copy it to the drive",
      });
    });

    it.each([
      ["install", "run", "_onPrimary"],
      ["step", "before", "_onBefore"],
    ] as const)(
      "frees the card and says why when the %s throws",
      async (_n, part, click) => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        engines.pico[part].mockImplementationOnce(async (hooks) => {
          hooks.onWaiting({ message: "now in BOOTSEL" });
          throw new Error("boom");
        });
        const { el, opener } = await handOff(pico, false);
        await (el as any)[click]();
        expect((el as any)._busy).toBe(false);
        expect((el as any)._waiting).toBeNull();
        expect(last(states(opener))).toMatchObject({ state: "error", detail: "boom" });
      }
    );

    it("goes back to the ready line when the install's chooser is dismissed", async () => {
      engines.pico.run.mockResolvedValueOnce("dismissed");
      const { el } = await handOff(pico);
      expect((el as any)._state).toBe("connecting");
      expect((el as any)._flashDone).toBe(false);
    });
  });

  it("shows the engine's last lines without waiting for a frame", async () => {
    engines.esp.run.mockImplementationOnce(async (_port, hooks) => {
      (hooks as unknown as { onLog: (line: string) => void }).onLog("Hard resetting");
      return { rebooted: true };
    });
    const { el } = await handOff({});
    expect((el as any)._logLines).toEqual(["Hard resetting"]);
  });

  it("drops the handed-over bytes from the card's state once the run holds them", async () => {
    const { el } = await handOff({ name: "fw.uf2" }, false);
    expect((el as any)._firmware).toMatchObject({ name: "fw.uf2", parts: [] });
  });
});
