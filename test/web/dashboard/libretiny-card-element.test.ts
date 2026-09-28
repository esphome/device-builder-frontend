// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  openPortForLogs: vi.fn(),
}));
vi.mock("../../../src/web/logs/esphome-web-logs-dialog.js", () => ({}));
vi.mock("../../../src/web/logs/open-port-for-logs.js", () => ({
  openPortForLogs: mocks.openPortForLogs,
}));
vi.mock("../../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock(
  "../../../src/web/platforms/rtl87xx/esphome-web-install-rtl-dialog.js",
  () => ({})
);
vi.mock("../../../src/web/dashboard/esphome-web-card.js", () => ({}));
vi.mock("../../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/tooltip/tooltip.js", () => ({}));

import { identityLocalize, mount } from "../../_dom.js";
import { expectTooltipsAnchored } from "../../_tooltip-anchors.js";
import { RTL87XX_SERIAL_LOGS } from "../../../src/platforms/rtl87xx/serial-logs.js";
import type { LibreTinyCardElement } from "../../../src/web/dashboard/libretiny-card-element.js";
import { ESPHomeWebRtlCard } from "../../../src/web/platforms/rtl87xx/esphome-web-rtl-card.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const logsDialog = (el: LibreTinyCardElement) =>
  el.shadowRoot!.querySelector("esphome-web-logs-dialog") as any;

beforeEach(() => {
  mocks.openPortForLogs.mockResolvedValue(true);
});

afterEach(() => {
  vi.resetAllMocks();
});

// What a family's card is: its element, its logs policy, its copy and its dialog.
describe.each([
  {
    name: "esphome-web-rtl-card",
    Card: ESPHomeWebRtlCard,
    // Release the lines, reset over RTS.
    policy: RTL87XX_SERIAL_LOGS,
    is: { reset: "rts-pulse", releaseLinesAfterOpen: true },
    title: "web.rtl.title",
    dialog: "esphome-web-install-rtl-dialog",
  },
])("$name", ({ Card, policy, is, title, dialog: installDialog }) => {
  const mountCard = () =>
    mount(new Card(), { _localize: identityLocalize } as Partial<LibreTinyCardElement>);

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
    expect(mocks.openPortForLogs).toHaveBeenCalledWith(
      port,
      expect.any(Function),
      policy
    );
    const dialog = logsDialog(el);
    expect(dialog.port).toBe(port);
    expect(dialog.hasAttribute("open")).toBe(true);
    // One policy for both the open and the dialog's reopens.
    expect(dialog.policy).toBe(policy);
    expect(policy).toEqual(is);
    expect(dialog.deviceLabel).toBe(title);
  });

  it("opens its own install dialog", async () => {
    const el = await mountCard();
    const install = () => el.shadowRoot!.querySelector(installDialog) as HTMLElement;
    expect(install().hasAttribute("open")).toBe(false);

    (el.shadowRoot!.querySelector(".action-btn--primary") as HTMLElement).click();
    await el.updateComplete;
    expect(install().hasAttribute("open")).toBe(true);

    install().dispatchEvent(new CustomEvent("after-hide"));
    await el.updateComplete;
    expect(install().hasAttribute("open")).toBe(false);
  });

  it("opens its install dialog anew for a click that came while it was hiding", async () => {
    const el = await mountCard();
    const install = () => el.shadowRoot!.querySelector(installDialog) as HTMLElement;
    const button = el.shadowRoot!.querySelector(".action-btn--primary") as HTMLElement;
    button.click();
    await el.updateComplete;

    // The dialog is on its way out, and its after-hide comes after the click.
    button.click();
    install().dispatchEvent(new CustomEvent("after-hide"));
    await el.updateComplete;
    // Closed first, so that the dialog starts over.
    expect(install().hasAttribute("open")).toBe(false);
    await vi.waitFor(() => expect(install().hasAttribute("open")).toBe(true));

    // The one click is used up: the next hide closes the dialog.
    install().dispatchEvent(new CustomEvent("after-hide"));
    await el.updateComplete;
    await el.updateComplete;
    expect(install().hasAttribute("open")).toBe(false);
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
