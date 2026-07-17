/**
 * @vitest-environment happy-dom
 *
 * Pins the version-prefill routing (Device Builder rows carry the server
 * version, the ESPHome row carries the installed core version, and rows
 * without a source or version are left untouched) and the write-in-English
 * note that only the "Report a new issue" drill screen shows.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeFeedbackDialog } from "../../src/components/feedback-dialog.js";
import { mount } from "../_dom.js";

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
