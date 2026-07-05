// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";

import { ESPHomeLayout } from "../../src/components/esphome-layout.js";

interface FooterVersions {
  _serverVersion: string;
  _esphomeVersion: string;
  _desktopVersion: string;
}

async function renderFooter(
  serverVersion: string,
  esphomeVersion: string,
  desktopVersion = ""
): Promise<ESPHomeLayout> {
  const el = new ESPHomeLayout();
  const view = el as unknown as FooterVersions;
  view._serverVersion = serverVersion;
  view._esphomeVersion = esphomeVersion;
  view._desktopVersion = desktopVersion;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function footerLinks(el: ESPHomeLayout): HTMLAnchorElement[] {
  return Array.from(el.shadowRoot!.querySelectorAll(".app-footer a"));
}

describe("esphome-layout footer version links", () => {
  let el: ESPHomeLayout | undefined;

  afterEach(() => {
    el?.remove();
    el = undefined;
  });

  test("links stable versions to their release notes", async () => {
    el = await renderFooter("1.0.3", "2026.5.3");
    const links = footerLinks(el);
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe(
      "https://github.com/esphome/device-builder/releases/tag/1.0.3"
    );
    expect(links[0].textContent?.trim()).toBe("ESPHome Device Builder v1.0.3");
    expect(links[1].getAttribute("href")).toBe("https://esphome.io/changelog/2026.5.0/");
    expect(links[1].textContent?.trim()).toBe("ESPHome 2026.5.3");
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  test("shows the desktop version first, linked to the desktop docs", async () => {
    el = await renderFooter("1.0.3", "2026.5.3", "1.4.2");
    const links = footerLinks(el);
    expect(links).toHaveLength(3);
    expect(links[0].textContent?.trim()).toBe("ESPHome Desktop v1.4.2");
    expect(links[0].getAttribute("href")).toBe("https://desktop.esphome.io/");
  });

  test("omits the desktop line when no desktop version is set", async () => {
    el = await renderFooter("1.0.3", "2026.5.3");
    const footer = el.shadowRoot!.querySelector(".app-footer")?.textContent;
    expect(footer).not.toContain("Desktop");
    expect(footerLinks(el)).toHaveLength(2);
  });

  test("dev Device Builder stays plain text; dev ESPHome links to the next docs root", async () => {
    el = await renderFooter("0.0.0", "2026.7.0-dev");
    const links = footerLinks(el);
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("https://next.esphome.io/");
    expect(links[0].textContent?.trim()).toBe("ESPHome 2026.7.0-dev");
    const footer = el.shadowRoot!.querySelector(".app-footer")?.textContent;
    expect(footer).toContain("ESPHome Device Builder v0.0.0");
  });
});
