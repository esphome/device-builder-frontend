/**
 * @vitest-environment happy-dom
 *
 * Version badge and release-link rendering in the kebab menu footer.
 * These behaviours were split out of the deleted esphome-layout components
 * (esphome-layout-version-badge and esphome-layout-footer) and relocated
 * into esphome-header-actions. The test coverage is ported accordingly.
 */
import { afterEach, describe, expect, test } from "vitest";

import { ESPHomeHeaderActions } from "../../src/components/esphome-header-actions.js";

interface PrivateView {
  _serverVersion: string;
  _esphomeVersion: string;
  readonly _versionBadge: string | null;
  _open: boolean;
}

async function renderVersions(
  serverVersion: string,
  esphomeVersion: string
): Promise<ESPHomeHeaderActions> {
  const el = new ESPHomeHeaderActions();
  const view = el as unknown as PrivateView;
  view._serverVersion = serverVersion;
  view._esphomeVersion = esphomeVersion;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("header-actions version badge", () => {
  let el: ESPHomeHeaderActions | undefined;

  afterEach(() => {
    el?.remove();
    el = undefined;
  });

  test("shows Dev badge for a dev backend", async () => {
    el = await renderVersions("0.0.0", "2026.7.0-dev");
    expect((el as unknown as PrivateView)._versionBadge).toBe("Dev");
  });

  test("shows Beta badge for a pre-release backend", async () => {
    el = await renderVersions("0.1.0b117", "2026.7.0b1");
    expect((el as unknown as PrivateView)._versionBadge).toBe("Beta");
  });

  test("shows null for a stable backend", async () => {
    el = await renderVersions("1.0.0", "2026.5.3");
    expect((el as unknown as PrivateView)._versionBadge).toBeNull();
  });

  test("shows null when server version is empty string", async () => {
    el = await renderVersions("", "2026.5.3");
    expect((el as unknown as PrivateView)._versionBadge).toBeNull();
  });
});

describe("header-actions version links", () => {
  let el: ESPHomeHeaderActions | undefined;

  afterEach(() => {
    el?.remove();
    el = undefined;
  });

  test("stable Device Builder links to release notes; stable ESPHome links to changelog", async () => {
    el = await renderVersions("1.0.3", "2026.5.3");
    // Force the menu open so the version info renders
    (el as unknown as PrivateView)._open = true;
    await el.updateComplete;

    const links =
      el.shadowRoot!.querySelectorAll<HTMLAnchorElement>(".menu-version-link");
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

  test("dev Device Builder stays plain text; dev ESPHome links to next docs", async () => {
    el = await renderVersions("0.0.0", "2026.7.0-dev");
    (el as unknown as PrivateView)._open = true;
    await el.updateComplete;

    const links =
      el.shadowRoot!.querySelectorAll<HTMLAnchorElement>(".menu-version-link");
    // Only the ESPHome link exists (ESPHome changelog; Device Builder dev = no release URL)
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("https://next.esphome.io/");
    expect(links[0].textContent?.trim()).toBe("ESPHome 2026.7.0-dev");

    // The Device Builder version should render as plain text (no anchor)
    const versionInfo = el.shadowRoot!.querySelector(".menu-version-info")?.textContent;
    expect(versionInfo).toContain("ESPHome Device Builder v0.0.0");
  });

  test("badge renders in the menu when server version is dev", async () => {
    el = await renderVersions("0.0.0", "2026.7.0-dev");
    (el as unknown as PrivateView)._open = true;
    await el.updateComplete;

    const badge = el.shadowRoot!.querySelector(".menu-version-badge");
    expect(badge).not.toBeNull();
    expect(badge?.textContent?.trim()).toBe("Dev");
  });

  test("no badge when server version is stable", async () => {
    el = await renderVersions("1.0.0", "2026.5.3");
    (el as unknown as PrivateView)._open = true;
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector(".menu-version-badge")).toBeNull();
  });
});
