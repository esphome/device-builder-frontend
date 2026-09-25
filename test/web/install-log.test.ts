// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../src/components/ansi-log.js", () => ({}));
const downloadAnsiText = vi.fn();
vi.mock("../../src/util/download-text.js", () => ({
  downloadAnsiText: (...args: unknown[]) => downloadAnsiText(...args),
}));

import { identityLocalize, mount } from "../_dom.js";
import { ESPHomeWebInstallLog } from "../../src/web/install/esphome-web-install-log.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function mountLog(lines: string[]): Promise<ESPHomeWebInstallLog> {
  const el = new ESPHomeWebInstallLog();
  (el as any)._localize = identityLocalize;
  return mount(el, { lines });
}

const buttons = (el: ESPHomeWebInstallLog) => [
  ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>("button"),
];
const toggle = (el: ESPHomeWebInstallLog) =>
  buttons(el).find((b) => b.textContent!.includes("details"))!;

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("esphome-web-install-log", () => {
  it("renders nothing until a line arrives", async () => {
    const el = await mountLog([]);
    expect(el.shadowRoot!.querySelector("button")).toBeNull();
    el.lines = ["Touching the port at 1200 baud"];
    await el.updateComplete;
    expect(toggle(el).textContent).toContain("firmware.show_details");
    expect(el.shadowRoot!.querySelector("esphome-ansi-log")).toBeNull();
  });

  it("expands into the ansi log and collapses again", async () => {
    const el = await mountLog(["a", "b"]);
    toggle(el).click();
    await el.updateComplete;
    const log = el.shadowRoot!.querySelector("esphome-ansi-log") as any;
    expect(log.lines).toEqual(["a", "b"]);
    expect(toggle(el).textContent).toContain("firmware.hide_details");
    toggle(el).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("esphome-ansi-log")).toBeNull();
  });

  it("downloads the lines as a text file", async () => {
    const el = await mountLog(["a", "b"]);
    buttons(el)
      .find((b) => b.textContent!.includes("dashboard.logs_download"))!
      .click();
    expect(downloadAnsiText).toHaveBeenCalledWith(["a", "b"], "esphome-web-install.txt");
  });
});
