// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../src/components/ansi-log.js", () => ({}));
const downloadAnsiText = vi.fn();
vi.mock("../../src/util/download-text.js", () => ({
  downloadAnsiText: (...args: unknown[]) => downloadAnsiText(...args),
}));

import { identityLocalize, mount } from "../_dom.js";
import { ESPHomeInstallDetailsLog } from "../../src/components/install-details-log.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function mountLog(lines: string[]): Promise<ESPHomeInstallDetailsLog> {
  return mount(new ESPHomeInstallDetailsLog(), {
    _localize: identityLocalize,
    lines,
    targetPlatform: "esp32",
  } as Partial<ESPHomeInstallDetailsLog>);
}

const buttons = (el: ESPHomeInstallDetailsLog) => [
  ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>("button"),
];
const toggle = (el: ESPHomeInstallDetailsLog) =>
  buttons(el).find((b) => b.textContent!.includes("details"))!;
const ansiLog = (el: ESPHomeInstallDetailsLog) =>
  el.shadowRoot!.querySelector("esphome-ansi-log") as any;

afterEach(() => {
  vi.clearAllMocks();
});

describe("esphome-install-details-log", () => {
  it("expands into the ansi log, reporting the change, and collapses again", async () => {
    const el = await mountLog(["a", "b"]);
    const changed = vi.fn();
    el.addEventListener("expanded-changed", (e) => changed((e as CustomEvent).detail));
    expect(ansiLog(el)).toBeNull();
    expect(toggle(el).getAttribute("aria-expanded")).toBe("false");
    toggle(el).click();
    await el.updateComplete;
    expect(changed).toHaveBeenLastCalledWith(true);
    expect(toggle(el).getAttribute("aria-expanded")).toBe("true");
    expect(toggle(el).getAttribute("aria-controls")).toBe("log");
    expect(ansiLog(el).lines).toEqual(["a", "b"]);
    expect(ansiLog(el).targetPlatform).toBe("esp32");
    expect(toggle(el).textContent).toContain("firmware.hide_details");
    toggle(el).click();
    await el.updateComplete;
    expect(changed).toHaveBeenLastCalledWith(false);
    expect(ansiLog(el)).toBeNull();
  });

  it("follows an expanded value the host sets", async () => {
    const el = await mountLog(["a"]);
    el.expanded = true;
    await el.updateComplete;
    expect(ansiLog(el).lines).toEqual(["a"]);
  });

  it("downloads the lines under the given name", async () => {
    const el = await mountLog(["a", "b"]);
    el.downloadName = "kitchen-install.txt";
    buttons(el)
      .find((b) => b.textContent!.includes("dashboard.logs_download"))!
      .click();
    expect(downloadAnsiText).toHaveBeenCalledWith(["a", "b"], "kitchen-install.txt");
  });

  it("leaves the download to a host that cancels download-log", async () => {
    const el = await mountLog(["a"]);
    el.addEventListener("download-log", (e) => e.preventDefault());
    buttons(el)
      .find((b) => b.textContent!.includes("dashboard.logs_download"))!
      .click();
    expect(downloadAnsiText).not.toHaveBeenCalled();
  });
});
