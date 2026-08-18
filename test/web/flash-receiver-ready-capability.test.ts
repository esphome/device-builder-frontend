// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/util/web-serial.js", () => ({
  isPortPickerCancel: vi.fn(() => false),
  webSerialAvailability: vi.fn(() => "available"),
}));
vi.mock("../../src/web/install/run-flash.js", () => ({ runFlash: vi.fn() }));
vi.mock("../../src/web/dashboard/esphome-web-card.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("../../src/components/ansi-log.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));
vi.mock("../../src/web/logs/esphome-web-logs-dialog.js", () => ({
  openPortForLogs: vi.fn(async () => true),
}));

import { webSerialAvailability } from "../../src/util/web-serial.js";
import { ESPHomeWebFlashReceiver } from "../../src/web/flash-receiver/esphome-web-flash-receiver.js";
import { MSG_READY } from "../../src/web/flash-receiver/protocol.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.mocked(webSerialAvailability).mockReturnValue("available");
});

// Mounts the receiver with a fake opener + nonce hash (a hand-off page) and
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

// Covers the component→handshake wiring itself: a broken translation of
// webSerialAvailability() into the env boolean would pass the handshake and
// sender unit tests while silently advertising the wrong capability.
describe("esphome-web-flash-receiver ready capability", () => {
  it("advertises webSerial: true when Web Serial is available", async () => {
    const ready = await mountAndCollectReady();
    expect(ready.length).toBeGreaterThan(0);
    expect(ready[0].webSerial).toBe(true);
  });

  it("advertises webSerial: false when the browser can't flash", async () => {
    vi.mocked(webSerialAvailability).mockReturnValue("unsupported");
    const ready = await mountAndCollectReady();
    expect(ready.length).toBeGreaterThan(0);
    expect(ready[0].webSerial).toBe(false);
  });
});
