// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const openNoPortPickedDialog = vi.fn();
vi.mock("../../src/web/dashboard/esphome-web-no-port-picked-dialog.js", () => ({
  openNoPortPickedDialog: (...a: unknown[]) => openNoPortPickedDialog(...a),
}));
const isPortPickerCancel = vi.fn((..._a: unknown[]) => true);
const reacquirePort = vi.fn();
vi.mock("../../src/util/web-serial.js", () => ({
  isPortPickerCancel: (...a: unknown[]) => isPortPickerCancel(...a),
  reacquirePort: (...a: unknown[]) => reacquirePort(...a),
}));
vi.mock("../../src/web/dashboard/esphome-web-card.js", () => ({}));
vi.mock("../../src/web/dashboard/esphome-web-esp-device-card.js", () => ({}));
vi.mock("../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import toast from "sonner-js";
import { flush } from "../_dom.js";
import { makeDisconnectPort } from "../_web-serial.js";
import { ESPHomeWebEspConnectCard } from "../../src/web/dashboard/esphome-web-esp-connect-card.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  isPortPickerCancel.mockReturnValue(true);
});

describe("esphome-web-esp-connect-card connect cancel", () => {
  it("offers driver help + retry when the picker is cancelled", async () => {
    const el = new ESPHomeWebEspConnectCard();
    (el as any)._localize = (k: string) => k;
    (navigator as any).serial = {
      requestPort: vi.fn(async () => {
        throw new DOMException("cancel", "NotFoundError");
      }),
    };

    await (el as any)._connect();

    expect(openNoPortPickedDialog).toHaveBeenCalledOnce();
    // Second arg is the retry — re-invokes connect.
    expect(typeof openNoPortPickedDialog.mock.calls[0][1]).toBe("function");
    expect(toast.error).not.toHaveBeenCalled();
    expect((el as any)._port).toBeUndefined();
  });

  it("toasts (no driver dialog) on a real connect error", async () => {
    isPortPickerCancel.mockReturnValue(false);
    const el = new ESPHomeWebEspConnectCard();
    (el as any)._localize = (k: string) => k;
    (navigator as any).serial = {
      requestPort: vi.fn(async () => {
        throw new Error("boom");
      }),
    };

    await (el as any)._connect();

    expect(openNoPortPickedDialog).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledOnce();
  });
});

describe("esphome-web-esp-connect-card disconnect resilience", () => {
  async function connected(port: SerialPort): Promise<ESPHomeWebEspConnectCard> {
    const el = new ESPHomeWebEspConnectCard();
    (el as any)._localize = (k: string) => k;
    (navigator as any).serial = { requestPort: vi.fn(async () => port) };
    await (el as any)._connect();
    expect((el as any)._port).toBe(port);
    return el;
  }

  it("folds a dialog-recovered handle in via port-replaced (composed hop)", async () => {
    const port = makeDisconnectPort();
    const live = makeDisconnectPort();
    const el = await connected(port);
    document.body.appendChild(el);
    await (el as any).updateComplete;

    // The logs dialog dispatches from inside the device card's shadow
    // root; give the stubbed card one so the event genuinely crosses a
    // shadow boundary — composed: true is what carries it out.
    const device = el.shadowRoot!.querySelector("esphome-web-esp-device-card")!;
    const inner = document.createElement("div");
    device.attachShadow({ mode: "open" }).appendChild(inner);
    inner.dispatchEvent(
      new CustomEvent("port-replaced", { detail: live, bubbles: true, composed: true })
    );

    expect((el as any)._port).toBe(live);
    expect(live.listenerCount()).toBe(1);
    el.remove();
  });

  it("keeps the device card through a re-enum blip, rebinding the live handle (#1410)", async () => {
    const port = makeDisconnectPort();
    const fresh = makeDisconnectPort();
    reacquirePort.mockResolvedValue(fresh);
    const el = await connected(port);

    port.fire();
    await flush();

    expect((el as any)._port).toBe(fresh);
  });

  it("falls back to the connect screen when the device stays gone", async () => {
    const port = makeDisconnectPort();
    reacquirePort.mockResolvedValue(null);
    const el = await connected(port);

    port.fire();
    await flush();

    expect((el as any)._port).toBeUndefined();
  });

  it("explicit disconnect resets immediately, ignoring a pending reacquire", async () => {
    const port = makeDisconnectPort();
    let resolve!: (v: SerialPort | null) => void;
    reacquirePort.mockReturnValue(new Promise((r) => (resolve = r)));
    const el = await connected(port);

    port.fire();
    (el as any)._handleClose();
    expect((el as any)._port).toBeUndefined();

    resolve(makeDisconnectPort());
    await flush();
    expect((el as any)._port).toBeUndefined();
  });
});
