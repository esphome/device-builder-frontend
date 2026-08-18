// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/util/web-serial.js", () => ({
  isPortPickerCancel: vi.fn(() => false),
  webSerialAvailability: vi.fn(() => "unsupported"),
}));
vi.mock("../../src/web/install/run-flash.js", () => ({ runFlash: vi.fn() }));
vi.mock("../../src/web/dashboard/esphome-web-card.js", () => ({}));
vi.mock("../../src/web/dashboard/esphome-web-unsupported-card.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("../../src/components/ansi-log.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));
vi.mock("../../src/web/logs/esphome-web-logs-dialog.js", () => ({
  openPortForLogs: vi.fn(async () => true),
}));

import { ESPHomeWebFlashReceiver } from "../../src/web/flash-receiver/esphome-web-flash-receiver.js";
import { MSG_FIRMWARE } from "../../src/web/flash-receiver/protocol.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("esphome-web-flash-receiver on an unsupported browser", () => {
  it("renders the unsupported card instead of the flash UI", async () => {
    const el = new ESPHomeWebFlashReceiver();
    (el as any)._localize = (k: string) => k;
    document.body.appendChild(el);
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector("esphome-web-unsupported-card")).not.toBeNull();
    expect(el.shadowRoot?.querySelector(".wrap")).toBeNull();
  });

  it("relays an error to the opener instead of hanging once firmware arrives", async () => {
    const openerPost = vi.fn();
    const opener = { postMessage: openerPost };
    Object.defineProperty(window, "opener", { value: opener, configurable: true });
    const origHash = window.location.hash;
    window.location.hash = "#nonce=n1";
    try {
      const el = new ESPHomeWebFlashReceiver();
      (el as any)._localize = (k: string) => k;
      document.body.appendChild(el);
      await el.updateComplete;

      const ev = new MessageEvent("message", {
        data: {
          type: MSG_FIRMWARE,
          nonce: "n1",
          parts: [{ address: 0, data: new ArrayBuffer(4) }],
        },
      });
      Object.defineProperty(ev, "source", { value: opener });
      window.dispatchEvent(ev);
      await el.updateComplete;

      expect((el as any)._state).toBe("error");
      expect((el as any)._statusMessage).toBe("web.unsupported.browser");
      // Handed off (firmware arrived), so the opener's own handedOff-gated
      // listener actually accepts this state frame instead of it being
      // dropped pre-handoff.
      const stateFrame = openerPost.mock.calls
        .map((args) => args[0])
        .find((msg) => msg.type === "esphome-web-flash:state");
      expect(stateFrame).toMatchObject({ state: "error" });
    } finally {
      window.location.hash = origHash;
      delete (window as any).opener;
    }
  });
});
