// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/web/dashboard/esphome-web-dashboard.js", () => ({}));
vi.mock("../../src/web/flash-receiver/esphome-web-flash-receiver.js", () => ({}));
vi.mock("../../src/web/header/esphome-web-header.js", () => ({}));
const { notifyInfo, isRecentSerialActivity, hasOpenDialog, isImprovInProgress } =
  vi.hoisted(() => ({
    notifyInfo: vi.fn(),
    isRecentSerialActivity: vi.fn(() => false),
    hasOpenDialog: vi.fn(() => false),
    isImprovInProgress: vi.fn(() => false),
  }));
vi.mock("../../src/components/base-dialog.js", () => ({ hasOpenDialog }));
vi.mock("../../src/web/improv/open-improv-dialog.js", () => ({ isImprovInProgress }));
vi.mock("../../src/util/notify.js", () => ({ LONG_TOAST_DURATION_MS: 8000, notifyInfo }));
vi.mock("../../src/util/serial-reacquire.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isRecentSerialActivity,
  isOwnSerialReenumeration: isRecentSerialActivity,
}));
// The shell loads its own catalog; keep the keys visible.
vi.mock("../../src/common/localize.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  defaultLocalize: (key: string) => key,
  loadLocalize: async () => (key: string) => key,
}));

import { mount } from "../_dom.js";
import { withWebSerial } from "../_web-serial.js";
import { ESPHomeWebApp } from "../../src/web/esphome-web-app.js";
import { makeUsbPort } from "./_make-web-serial-port.js";

const PICO = makeUsbPort(0x2e8a, 0xf00a);
const ESP = makeUsbPort(0x303a, 0x1001);

let serialListeners: Record<string, (e: Event) => void>;
let restoreSerial: () => void;

beforeEach(() => {
  serialListeners = {};
  restoreSerial = withWebSerial(true, {
    addEventListener: (type: string, fn: (e: Event) => void) => {
      serialListeners[type] = fn;
    },
    removeEventListener: () => {},
  });
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  restoreSerial();
  vi.clearAllMocks();
  isRecentSerialActivity.mockReturnValue(false);
  hasOpenDialog.mockReturnValue(false);
  isImprovInProgress.mockReturnValue(false);
});

const mountApp = () => mount(new ESPHomeWebApp());
const pick = (el: ESPHomeWebApp, p: SerialPort) =>
  el.dispatchEvent(new CustomEvent("port-picked", { detail: p, bubbles: true }));
// Current Chromium fires connect at the port itself (event.target).
const plugIn = (p: SerialPort) =>
  serialListeners.connect({ target: p } as unknown as Event);

describe("web app flow-switch suggestion", () => {
  it("offers the Pico flow when a picked port looks like a Pico, and switches on the action", async () => {
    const el = await mountApp();
    pick(el, PICO);
    expect(notifyInfo).toHaveBeenCalledTimes(1);
    const [message, options] = notifyInfo.mock.lastCall!;
    expect(message).toBe("web.flow_switch.pico");
    expect(options.action.label).toBe("web.flow_switch.action_pico");
    options.action.onClick();
    expect(window.location.search).toBe("?pico");
  });

  it("stays quiet for a port of the current family or an unknown one", async () => {
    const el = await mountApp();
    pick(el, ESP);
    pick(el, makeUsbPort(0x1366, 0x1015));
    expect(notifyInfo).not.toHaveBeenCalled();
  });

  it("offers the switch when an already-permitted device is plugged in, once per port", async () => {
    await mountApp();
    plugIn(PICO);
    plugIn(PICO);
    expect(notifyInfo).toHaveBeenCalledTimes(1);
    expect(notifyInfo.mock.lastCall![0]).toBe("web.flow_switch.pico");
  });

  it("also reads the legacy event.port shape", async () => {
    await mountApp();
    serialListeners.connect({ port: PICO, target: null } as unknown as Event);
    expect(notifyInfo).toHaveBeenCalledTimes(1);
  });

  it("does not push the URL twice when a stale toast is clicked after a manual switch", async () => {
    const el = await mountApp();
    pick(el, PICO);
    const { onClick } = notifyInfo.mock.lastCall![1].action;
    const before = window.history.length;
    (el as unknown as { _setMode: (m: string) => void })._setMode("pico");
    onClick();
    expect(window.history.length).toBe(before + 1);
    expect(window.location.search).toBe("?pico");
  });

  it("stays quiet while a dialog is up, since a switch would unmount the running operation", async () => {
    const el = await mountApp();
    hasOpenDialog.mockReturnValue(true);
    pick(el, PICO);
    plugIn(PICO);
    hasOpenDialog.mockReturnValue(false);
    isImprovInProgress.mockReturnValue(true);
    pick(el, PICO);
    expect(notifyInfo).not.toHaveBeenCalled();
  });

  it("does not apply a stale toast once a dialog has opened", async () => {
    const el = await mountApp();
    pick(el, PICO);
    const { onClick } = notifyInfo.mock.lastCall![1].action;
    hasOpenDialog.mockReturnValue(true);
    onClick();
    expect(window.location.search).toBe("");
    // The refusal is not silent.
    expect(notifyInfo.mock.lastCall![0]).toBe("web.flow_switch.busy");
  });

  it("keeps the offer for a replug once the dialog that suppressed it has closed", async () => {
    await mountApp();
    hasOpenDialog.mockReturnValue(true);
    plugIn(PICO);
    hasOpenDialog.mockReturnValue(false);
    plugIn(PICO);
    expect(notifyInfo).toHaveBeenCalledTimes(1);
  });

  it("ignores a plug-in that is our own touch or flash re-enumerating", async () => {
    await mountApp();
    isRecentSerialActivity.mockReturnValue(true);
    plugIn(PICO);
    expect(notifyInfo).not.toHaveBeenCalled();
  });
});
