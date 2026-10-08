// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  openPortForLogs: vi.fn(),
  openImprovDialog: vi.fn(),
}));
vi.mock("../../../src/web/logs/esphome-web-logs-dialog.js", () => ({}));
vi.mock("../../../src/web/logs/open-port-for-logs.js", () => ({
  openPortForLogs: mocks.openPortForLogs,
}));
vi.mock("../../../src/web/improv/open-improv-dialog.js", () => ({
  openImprovDialog: mocks.openImprovDialog,
}));
vi.mock("../../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../../src/web/install/esphome-web-libretiny-install-dialog.js", () => ({}));
vi.mock("../../../src/web/dashboard/esphome-web-card.js", () => ({}));
vi.mock("../../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/tooltip/tooltip.js", () => ({}));

import { identityLocalize, mount } from "../../_dom.js";
import { expectTooltipsAnchored } from "../../_tooltip-anchors.js";
import { BK72XX_SERIAL_LOGS } from "../../../src/platforms/bk72xx/serial-logs.js";
import { LN882X_SERIAL_LOGS } from "../../../src/platforms/ln882x/serial-logs.js";
import { RTL87XX_SERIAL_LOGS } from "../../../src/platforms/rtl87xx/serial-logs.js";
import { LibreTinyCardElement } from "../../../src/web/dashboard/esphome-web-libretiny-card.js";
import { BK_CARD } from "../../../src/web/platforms/bk72xx/card.js";
import { LN_CARD } from "../../../src/web/platforms/ln882x/card.js";
import { RTL_CARD } from "../../../src/web/platforms/rtl87xx/card.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const logsDialog = (el: LibreTinyCardElement) =>
  el.shadowRoot!.querySelector("esphome-web-logs-dialog") as any;

beforeEach(() => {
  mocks.openPortForLogs.mockResolvedValue(true);
});

afterEach(() => {
  vi.resetAllMocks();
});

const installDialog = "esphome-web-libretiny-install-dialog";

// What a family's card is: its data, its logs policy and its copy.
describe.each([
  {
    name: "rtl87xx",
    card: RTL_CARD,
    // Release the lines, reset over RTS.
    policy: RTL87XX_SERIAL_LOGS,
    is: { reset: "rts-pulse", releaseLinesAfterOpen: true },
    title: "web.rtl.title",
  },
  {
    name: "bk72xx",
    card: BK_CARD,
    // Release the lines, reset over RTS.
    policy: BK72XX_SERIAL_LOGS,
    is: { reset: "rts-pulse", releaseLinesAfterOpen: true },
    title: "web.bk.title",
  },
  {
    name: "ln882x",
    card: LN_CARD,
    // Release the lines, reset over RTS.
    policy: LN882X_SERIAL_LOGS,
    is: { reset: "rts-pulse", releaseLinesAfterOpen: true },
    title: "web.ln.title",
  },
])("esphome-web-libretiny-card for $name", ({ card, policy, is, title }) => {
  const mountCard = () =>
    mount(new LibreTinyCardElement(), {
      _localize: identityLocalize,
      card,
    } as Partial<LibreTinyCardElement>);

  it("anchors every action tooltip to a real button id", async () => {
    expectTooltipsAnchored(await mountCard(), 2);
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

  it("opens the install dialog for its family", async () => {
    const el = await mountCard();
    const install = () => el.shadowRoot!.querySelector(installDialog)!;
    expect(install().install).toBe(card.install);
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

  it("sets up Wi-Fi over Improv on the picked port", async () => {
    const port = { getInfo: () => ({}) };
    mocks.requestSerialPort.mockResolvedValue(port);
    const el = await mountCard();
    const picked = vi.fn();
    el.addEventListener("port-picked", (e) => picked((e as CustomEvent).detail));
    (el.shadowRoot!.querySelector("#btn-wifi") as HTMLElement).click();
    await vi.waitFor(() => expect(mocks.openImprovDialog).toHaveBeenCalledTimes(1));
    expect(picked).toHaveBeenCalledWith(port);
    // Improv opens the port itself and releases DTR and RTS by default.
    expect(mocks.openImprovDialog).toHaveBeenCalledWith(port, expect.any(Function));
    expect(mocks.openPortForLogs).not.toHaveBeenCalled();
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

describe("esphome-web-libretiny-card Wi-Fi setup", () => {
  const mountCard = () =>
    mount(new LibreTinyCardElement(), {
      _localize: identityLocalize,
      card: RTL_CARD,
    } as Partial<LibreTinyCardElement>);

  it("does nothing when the picker is dismissed or fails", async () => {
    const el = await mountCard();
    mocks.requestSerialPort.mockResolvedValue(null);
    await (el as any)._configureWifi();
    mocks.requestSerialPort.mockRejectedValue(new Error("boom"));
    await (el as any)._configureWifi();
    expect(mocks.openImprovDialog).not.toHaveBeenCalled();
  });

  it("ignores a second click while a picker is up", async () => {
    const port = { getInfo: () => ({}) };
    let pick!: (port: unknown) => void;
    mocks.requestSerialPort.mockImplementation(
      () => new Promise((resolve) => (pick = resolve))
    );
    const el = await mountCard();
    const first = (el as any)._configureWifi();
    await (el as any)._configureWifi();
    await (el as any)._showLogs();
    expect(mocks.requestSerialPort).toHaveBeenCalledTimes(1);
    pick(port);
    await first;
    expect(mocks.openImprovDialog).toHaveBeenCalledTimes(1);
    expect(mocks.openPortForLogs).not.toHaveBeenCalled();
  });

  it("does not open Improv when the card was removed during the pick", async () => {
    let pick!: (port: unknown) => void;
    mocks.requestSerialPort.mockImplementation(
      () => new Promise((resolve) => (pick = resolve))
    );
    const el = await mountCard();
    const pending = (el as any)._configureWifi();
    el.remove();
    pick({ getInfo: () => ({}) });
    await pending;
    expect(mocks.openImprovDialog).not.toHaveBeenCalled();
  });
});
