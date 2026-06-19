// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { loading: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

import toast from "sonner-js";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type { ConfiguredDevice } from "../../src/api/types/devices.js";
import type { LocalizeFunc } from "../../src/common/localize.js";
import { flashViaUsb } from "../../src/util/usb-flasher.js";

const FLASHER_ORIGIN = "https://esphome.github.io";
const localize: LocalizeFunc = ((key: string) => key) as LocalizeFunc;

function makeApi(over: Partial<ESPHomeAPI> = {}): ESPHomeAPI {
  return {
    firmwareGetBinaries: vi
      .fn()
      .mockResolvedValue([
        { file: "firmware.factory.bin", title: "Factory", type: "factory" },
      ]),
    firmwareDownloadBytes: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
    firmwareCompile: vi.fn(),
    firmwareFollowJob: vi.fn(),
    ...over,
  } as unknown as ESPHomeAPI;
}

const device = (platform = "esp32") =>
  ({ configuration: "x.yaml", name: "x", target_platform: platform }) as ConfiguredDevice;

// Deliver a terminal state so flashViaUsb tears down its listener + timers.
function emitDone(fakeWin: { postMessage: unknown }) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "esphome-web-flash:state", state: "done" },
      origin: FLASHER_ORIGIN,
      source: fakeWin as unknown as Window,
    })
  );
}

beforeEach(() => {
  if (!crypto.randomUUID) {
    (crypto as unknown as { randomUUID: () => string }).randomUUID = () => "test-nonce";
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("flashViaUsb", () => {
  it("rejects non-ESP platforms without opening a window", async () => {
    const open = vi.spyOn(window, "open");
    await flashViaUsb(makeApi(), localize, device("rp2040"));
    expect(open).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("reports a blocked pop-up", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    await flashViaUsb(makeApi(), localize, device());
    expect(toast.error).toHaveBeenCalled();
  });

  it("opens the flasher with a nonce + origin and hands off the firmware on ready", async () => {
    const fakeWin = { postMessage: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const api = makeApi();

    // Kick off (synchronous part opens the window + attaches the listener),
    // then deliver the flasher's "ready" before the firmware finishes loading.
    const done = flashViaUsb(api, localize, device());
    const url = open.mock.calls[0][0] as string;
    expect(url).toContain("#nonce=");
    expect(url).toContain("origin=");

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "esphome-web-flash:ready" },
        origin: FLASHER_ORIGIN,
        source: fakeWin as unknown as Window,
      })
    );
    await done;

    expect(api.firmwareDownloadBytes).toHaveBeenCalledWith(
      "x.yaml",
      "firmware.factory.bin"
    );
    expect(fakeWin.postMessage).toHaveBeenCalledTimes(1);
    const [msg, targetOrigin, transfer] = fakeWin.postMessage.mock.calls[0];
    expect(msg.type).toBe("esphome-web-flash:firmware");
    expect(msg.parts[0].address).toBe(0);
    expect(targetOrigin).toBe(FLASHER_ORIGIN);
    expect(transfer).toHaveLength(1);
    emitDone(fakeWin); // terminal state tears down the listener + timers
  });

  it("surfaces a flasher 'error' state and tears down", async () => {
    const fakeWin = { postMessage: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);

    const done = flashViaUsb(makeApi(), localize, device());
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "esphome-web-flash:ready" },
        origin: FLASHER_ORIGIN,
        source: fakeWin as unknown as Window,
      })
    );
    await done;
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "esphome-web-flash:state", state: "error", detail: "boom" },
        origin: FLASHER_ORIGIN,
        source: fakeWin as unknown as Window,
      })
    );
    expect(toast.error).toHaveBeenCalledWith("boom", expect.anything());
  });

  it("compiles first when no binary is built yet", async () => {
    const followJob = vi.fn((_jobId: string, cbs: { onResult: (d: unknown) => void }) => {
      cbs.onResult({ status: "completed" });
      return "stream-1";
    });
    const api = makeApi({
      firmwareGetBinaries: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { file: "firmware.factory.bin", title: "Factory", type: "factory" },
        ]),
      firmwareCompile: vi.fn().mockResolvedValue({ job_id: "j1", source: "local" }),
      firmwareFollowJob: followJob,
    } as unknown as Partial<ESPHomeAPI>);
    const fakeWin = { postMessage: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);

    const done = flashViaUsb(api, localize, device());
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "esphome-web-flash:ready" },
        origin: FLASHER_ORIGIN,
        source: fakeWin as unknown as Window,
      })
    );
    await done;

    expect(api.firmwareCompile).toHaveBeenCalledWith("x.yaml");
    expect(fakeWin.postMessage).toHaveBeenCalledTimes(1);
    emitDone(fakeWin); // terminal state tears down the listener + timers
  });
});
