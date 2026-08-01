/**
 * @vitest-environment happy-dom
 *
 * Pins the version-prefill routing (Device Builder rows carry the server
 * version, the ESPHome row carries the installed core version, and rows
 * without a source or version are left untouched) and the write-in-English
 * note that only the "Report a new issue" drill screen shows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { flushMicrotasks, mount } from "../_dom.js";
import { APIError } from "../../src/api/api-error.js";
import { ESPHomeFeedbackDialog } from "../../src/components/feedback-dialog.js";

interface HrefLink {
  href?: string;
  versionSource?: "dashboard" | "esphome";
}

function dialog(serverVersion = "", esphomeVersion = "") {
  const el = new ESPHomeFeedbackDialog();
  Object.assign(el as unknown as Record<string, unknown>, {
    _serverVersion: serverVersion,
    _esphomeVersion: esphomeVersion,
  });
  return el as unknown as { _hrefFor(link: HrefLink): string };
}

describe("feedback-dialog version prefill", () => {
  it("appends the server version for Device Builder links", () => {
    expect(
      dialog("2026.6.0b1", "2026.6.0")._hrefFor({
        href: "https://github.com/esphome/device-builder/issues/new?template=bug_report.yml",
        versionSource: "dashboard",
      })
    ).toBe(
      "https://github.com/esphome/device-builder/issues/new?template=bug_report.yml&version=2026.6.0b1"
    );
  });

  it("appends the installed core version for the ESPHome link", () => {
    expect(
      dialog("2026.6.0b1", "2026.6.0")._hrefFor({
        href: "https://github.com/esphome/esphome/issues/new?template=bug_report.yml",
        versionSource: "esphome",
      })
    ).toBe(
      "https://github.com/esphome/esphome/issues/new?template=bug_report.yml&version=2026.6.0"
    );
  });

  it("leaves the href untouched when the matching version is empty", () => {
    expect(
      dialog("", "")._hrefFor({
        href: "https://github.com/esphome/device-builder/issues",
        versionSource: "dashboard",
      })
    ).toBe("https://github.com/esphome/device-builder/issues");
  });

  it("does not append a version when no source is set", () => {
    expect(
      dialog("2026.6.0b1", "2026.6.0")._hrefFor({
        href: "https://github.com/esphome/device-builder/issues",
      })
    ).toBe("https://github.com/esphome/device-builder/issues");
  });

  it("returns an empty string for a drill row with no href", () => {
    expect(dialog()._hrefFor({})).toBe("");
  });
});

describe("feedback-dialog write-in-English note", () => {
  const NOTE = "feedback.write_in_english";

  it("shows the note on the new-issue screen only", async () => {
    const el = await mount(new ESPHomeFeedbackDialog());
    el.open();
    await el.updateComplete;
    const drill = (screen: string) =>
      el.shadowRoot!.querySelector<HTMLButtonElement>(
        `button.link[data-drill="${screen}"]`
      );
    const back = () => el.shadowRoot!.querySelector<HTMLButtonElement>(".back-button");

    // Main screen: no note.
    expect(el.shadowRoot!.textContent).not.toContain(NOTE);

    // Drill into "Report a new issue" the way a user does: the note is there.
    drill("bug")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain(NOTE);

    // Back out and into the read-only browse screen: no note.
    back()!.click();
    await el.updateComplete;
    drill("browse")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).not.toContain(NOTE);
  });
});

describe("feedback-dialog device picker", () => {
  interface Deferred {
    resolve: (yaml: string) => void;
    reject: (err: unknown) => void;
  }

  const RAW_YAML = "esphome:\n  name: garage\nwifi:\n  password: hunter2";

  const DEVICE = {
    configuration: "garage.yaml",
    name: "garage",
    friendly_name: "Garage Door",
    current_version: "2026.7.1",
    target_platform: "ESP32S3",
    board_id: "esp32dev",
    loaded_integrations: ["esp32", "wifi"],
    runtime_state: { deployed_version: "2026.7.0" },
  };

  let el: ESPHomeFeedbackDialog;
  let reads: Deferred[];
  let openedUrls: string[];

  beforeEach(async () => {
    reads = [];
    openedUrls = [];
    vi.stubGlobal(
      "open",
      vi.fn((url: string) => {
        openedUrls.push(url);
        return null;
      })
    );
    el = await mount(new ESPHomeFeedbackDialog());
    Object.assign(el as unknown as Record<string, unknown>, {
      _serverVersion: "1.8.0",
      _esphomeVersion: "2026.7.2",
      _devices: [DEVICE],
      _api: {
        serverInfo: { in_docker: true },
        getConfig: vi.fn(
          () =>
            new Promise<string>((resolve, reject) => {
              reads.push({ resolve, reject });
            })
        ),
      },
    });
    el.open();
    await el.updateComplete;
  });

  const settle = async (predicate: () => boolean) => {
    for (let i = 0; i < 20 && !predicate(); i++) await flushMicrotasks(1);
  };

  const drillTo = async (target: "builder" | "esphome") => {
    el.shadowRoot!.querySelector<HTMLButtonElement>(
      'button.link[data-drill="bug"]'
    )!.click();
    await el.updateComplete;
    const rows = [
      ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(
        'button.link[data-drill="device"]'
      ),
    ];
    rows[target === "builder" ? 0 : 1].click();
    await el.updateComplete;
  };

  const deviceRow = () =>
    [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>("button.link")].find((b) =>
      b.textContent!.includes("Garage Door")
    )!;

  const skipRow = () =>
    [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>("button.link")].find((b) =>
      b.textContent!.includes("feedback.device_skip")
    )!;

  const pick = async (yaml = RAW_YAML) => {
    deviceRow().click();
    await settle(() => reads.length > 0);
    reads[0].resolve(yaml);
    await settle(() => openedUrls.length > 0);
  };

  it("prefills the builder form with masked config and facts", async () => {
    await drillTo("builder");
    await pick();
    const url = new URL(openedUrls[0]);
    expect(url.origin + url.pathname).toBe(
      "https://github.com/esphome/device-builder/issues/new"
    );
    expect(url.searchParams.get("version")).toBe("1.8.0");
    const config = url.searchParams.get("config")!;
    expect(config).not.toContain("hunter2");
    expect(config).toContain("password: \u2022");
    const facts = url.searchParams.get("extra")!;
    expect(facts).toContain("Garage Door (garage.yaml)");
    expect(facts).toContain("Board: esp32dev");
    expect(facts).toContain("Platform: ESP32");
    expect(facts).toContain("ESPHome running: 2026.7.0");
    expect(facts).toContain("ESPHome: 2026.7.2");
    expect(facts).toContain("Installation: Docker");
    expect((el as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(false);
  });

  it("prefills the esphome form with the device's compiled version", async () => {
    await drillTo("esphome");
    await pick();
    const url = new URL(openedUrls[0]);
    expect(url.origin + url.pathname).toBe(
      "https://github.com/esphome/esphome/issues/new"
    );
    expect(url.searchParams.get("version")).toBe("2026.7.1");
    expect(url.searchParams.get("additional")).toContain("Garage Door (garage.yaml)");
    expect(url.searchParams.get("config")).toContain("password: \u2022");
  });

  it("skip keeps today's URL plus the builder's required config sentinel", async () => {
    await drillTo("builder");
    skipRow().click();
    const builder = new URL(openedUrls[0]);
    expect(builder.searchParams.get("config")).toBe("not device specific");
    expect(builder.searchParams.get("version")).toBe("1.8.0");
    expect(builder.searchParams.get("extra")).toBeNull();

    // The mocked wa-dialog never fires after-hide, so reset as the real
    // close lifecycle does before reopening.
    (el as unknown as { _onAfterHide: () => void })._onAfterHide();
    el.open();
    await el.updateComplete;
    await drillTo("esphome");
    skipRow().click();
    const esphome = new URL(openedUrls[1]);
    expect(esphome.searchParams.get("config")).toBeNull();
    expect(esphome.searchParams.get("version")).toBe("2026.7.2");
  });

  it("opens the form without config when the capture fails", async () => {
    await drillTo("builder");
    deviceRow().click();
    await settle(() => reads.length > 0);
    reads[0].reject(new APIError("internal_error", "boom"));
    await settle(() => openedUrls.length > 0);
    const url = new URL(openedUrls[0]);
    expect(url.searchParams.get("config")).toBeNull();
    expect(url.searchParams.get("extra")).toContain("Garage Door (garage.yaml)");
  });

  it("keeps the whole URL under the budget for a huge config", async () => {
    const huge = Array.from(
      { length: 800 },
      (_, i) => `  line_${i}: value-${i}-abcdefghijklmnop`
    ).join("\n");
    await drillTo("builder");
    await pick(`esphome:\n${huge}`);
    const url = openedUrls[0];
    expect(url.length).toBeLessThanOrEqual(8000);
    expect(new URL(url).searchParams.get("config")).toContain(
      "[config truncated to fit the pre-filled URL]"
    );
  });

  it("drops a capture that resolves after the dialog closed", async () => {
    await drillTo("builder");
    deviceRow().click();
    await settle(() => reads.length > 0);
    (el as unknown as { _onAfterHide: () => void })._onAfterHide();
    reads[0].resolve(RAW_YAML);
    await flushMicrotasks(10);
    expect(openedUrls).toHaveLength(0);
  });
});
