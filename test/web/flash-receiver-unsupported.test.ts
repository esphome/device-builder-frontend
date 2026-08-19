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

import { webSerialAvailability } from "../../src/util/web-serial.js";
import { ESPHomeWebFlashReceiver } from "../../src/web/flash-receiver/esphome-web-flash-receiver.js";
import { MSG_FIRMWARE, MSG_READY } from "../../src/web/flash-receiver/protocol.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.mocked(webSerialAvailability).mockReturnValue("unsupported");
});

// Mounts a receiver with a fake opener + nonce hash (a hand-off page) and
// returns the ready frames it announced to the opener.
async function mountAndCollectReady() {
  const openerPost = vi.fn();
  Object.defineProperty(window, "opener", {
    value: { postMessage: openerPost },
    configurable: true,
  });
  const origHash = window.location.hash;
  window.location.hash = "#nonce=n1";
  try {
    const el = new ESPHomeWebFlashReceiver();
    (el as any)._localize = (k: string) => k;
    document.body.appendChild(el);
    await el.updateComplete;
    return openerPost.mock.calls
      .map((args) => args[0] as { type?: string; webSerial?: boolean })
      .filter((msg) => msg.type === MSG_READY);
  } finally {
    window.location.hash = origHash;
    delete (window as any).opener;
  }
}

// Mounts a receiver with a fake opener and delivers one firmware frame to it,
// exactly as the dashboard would after the nonce handshake.
async function handOffFirmware(
  opener: { postMessage: ReturnType<typeof vi.fn> },
  deviceName?: string
) {
  Object.defineProperty(window, "opener", { value: opener, configurable: true });
  window.location.hash = "#nonce=n1";
  const el = new ESPHomeWebFlashReceiver();
  (el as any)._localize = (k: string) => k;
  document.body.appendChild(el);
  await el.updateComplete;

  const ev = new MessageEvent("message", {
    data: {
      type: MSG_FIRMWARE,
      nonce: "n1",
      deviceName,
      parts: [{ address: 0, data: new ArrayBuffer(4) }],
    },
  });
  Object.defineProperty(ev, "source", { value: opener });
  window.dispatchEvent(ev);
  await el.updateComplete;
  return el;
}

describe("esphome-web-flash-receiver on an unsupported browser", () => {
  it("renders the unsupported card instead of the flash UI", async () => {
    const el = new ESPHomeWebFlashReceiver();
    (el as any)._localize = (k: string) => k;
    document.body.appendChild(el);
    await el.updateComplete;

    const card = el.shadowRoot?.querySelector("esphome-web-unsupported-card");
    expect(card).not.toBeNull();
    // Same width container as the flash UI so it doesn't render full-bleed.
    expect(card?.closest(".wrap")).not.toBeNull();
    expect(el.shadowRoot?.querySelector("esphome-web-card")).toBeNull();
  });

  it("relays an error to the opener instead of hanging once firmware arrives", async () => {
    const openerPost = vi.fn();
    const origHash = window.location.hash;
    const origTitle = document.title;
    try {
      const el = await handOffFirmware({ postMessage: openerPost }, "kitchen");

      expect((el as any)._state).toBe("error");
      expect((el as any)._statusMessage).toBe("web.unsupported.browser");
      // Handed off (firmware arrived), so the opener's own handedOff-gated
      // listener actually accepts this state frame instead of it being
      // dropped pre-handoff.
      const stateFrame = openerPost.mock.calls
        .map((args) => args[0])
        .find((msg) => msg.type === "esphome-web-flash:state");
      expect(stateFrame).toMatchObject({ state: "error" });
      // Bails before claiming a flash is in progress or holding the firmware.
      expect(document.title).toBe(origTitle);
      expect((el as any)._firmware).toBeUndefined();
    } finally {
      window.location.hash = origHash;
      delete (window as any).opener;
    }
  });

  it("relays the insecure-context message when that is the cause", async () => {
    vi.mocked(webSerialAvailability).mockReturnValue("insecure-context");
    const openerPost = vi.fn();
    const origHash = window.location.hash;
    try {
      const el = await handOffFirmware({ postMessage: openerPost });

      expect((el as any)._state).toBe("error");
      expect((el as any)._statusMessage).toBe("web.unsupported.insecure");
    } finally {
      window.location.hash = origHash;
      delete (window as any).opener;
    }
  });
});

// Covers the component→handshake wiring itself: a broken translation of the
// availability read into the env boolean would pass the handshake and sender
// unit tests while silently advertising the wrong capability.
describe("esphome-web-flash-receiver ready capability", () => {
  it("advertises webSerial: false when the browser can't flash", async () => {
    const ready = await mountAndCollectReady();
    expect(ready.length).toBeGreaterThan(0);
    expect(ready[0].webSerial).toBe(false);
  });

  it("advertises webSerial: true when Web Serial is available", async () => {
    vi.mocked(webSerialAvailability).mockReturnValue("available");
    const ready = await mountAndCollectReady();
    expect(ready.length).toBeGreaterThan(0);
    expect(ready[0].webSerial).toBe(true);
  });
});
