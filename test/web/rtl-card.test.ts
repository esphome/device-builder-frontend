// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  openPortForLogs: vi.fn(),
}));
vi.mock("../../src/web/logs/esphome-web-logs-dialog.js", () => ({}));
vi.mock("../../src/web/logs/open-port-for-logs.js", () => ({
  openPortForLogs: mocks.openPortForLogs,
}));
vi.mock("../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../src/web/install/esphome-web-install-rtl-dialog.js", () => ({}));
vi.mock("../../src/web/dashboard/esphome-web-card.js", () => ({}));
vi.mock("../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/tooltip/tooltip.js", () => ({}));

import { identityLocalize, mount } from "../_dom.js";
import { expectTooltipsAnchored } from "../_tooltip-anchors.js";
import { ESPHomeWebRtlCard } from "../../src/web/dashboard/esphome-web-rtl-card.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const mountCard = () =>
  mount(new ESPHomeWebRtlCard(), {
    _localize: identityLocalize,
  } as Partial<ESPHomeWebRtlCard>);
const logsDialog = (el: ESPHomeWebRtlCard) =>
  el.shadowRoot!.querySelector("esphome-web-logs-dialog") as any;

beforeEach(() => {
  mocks.openPortForLogs.mockResolvedValue(true);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("esphome-web-rtl-card", () => {
  it("anchors every action tooltip to a real button id", async () => {
    expectTooltipsAnchored(await mountCard(), 1);
  });

  it("opens the logs on the picked port with both control lines released", async () => {
    const port = { getInfo: () => ({}) };
    mocks.requestSerialPort.mockResolvedValue(port);
    const el = await mountCard();
    const picked = vi.fn();
    el.addEventListener("port-picked", (e) => picked((e as CustomEvent).detail));
    await (el as any)._showLogs();
    await el.updateComplete;
    expect(picked).toHaveBeenCalledWith(port);
    expect(mocks.openPortForLogs).toHaveBeenCalledWith(port, expect.any(Function), {
      releaseLines: true,
    });
    const dialog = logsDialog(el);
    expect(dialog.port).toBe(port);
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.resetMode).toBe("rts");
    expect(dialog.hasAttribute("release-lines")).toBe(true);
  });

  it("stays closed when the picker is dismissed or the port will not open", async () => {
    const el = await mountCard();
    mocks.requestSerialPort.mockResolvedValue(null);
    await (el as any)._showLogs();
    mocks.requestSerialPort.mockResolvedValue({ getInfo: () => ({}) });
    mocks.openPortForLogs.mockResolvedValue(false);
    await (el as any)._showLogs();
    await el.updateComplete;
    expect(logsDialog(el).hasAttribute("open")).toBe(false);
  });

  it("releases a port that opened after a flow switch removed the card", async () => {
    const port = { getInfo: () => ({}), close: vi.fn(async () => {}) };
    mocks.requestSerialPort.mockResolvedValue(port);
    let opened!: (ok: boolean) => void;
    mocks.openPortForLogs.mockImplementation(
      () => new Promise<boolean>((resolve) => (opened = resolve))
    );
    const el = await mountCard();
    const pending = (el as any)._showLogs();
    await vi.waitFor(() => expect(mocks.openPortForLogs).toHaveBeenCalled());
    el.remove();
    opened(true);
    await pending;
    expect(port.close).toHaveBeenCalledTimes(1);
    expect(logsDialog(el).hasAttribute("open")).toBe(false);
  });
});
