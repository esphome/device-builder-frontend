// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";

import { ESPHomeLayout } from "../../src/components/esphome-layout.js";

interface ServerVersionView {
  _serverVersion: string | null;
}

async function renderWithServerVersion(
  serverVersion: string | null
): Promise<ESPHomeLayout> {
  const el = new ESPHomeLayout();
  (el as unknown as ServerVersionView)._serverVersion = serverVersion;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function badge(el: ESPHomeLayout): HTMLElement | null {
  return el.shadowRoot!.querySelector(".preview-badge");
}

describe("esphome-layout version badge", () => {
  let el: ESPHomeLayout | undefined;

  afterEach(() => {
    el?.remove();
    el = undefined;
  });

  test("renders with no badge and does not throw when server version is null", async () => {
    el = await renderWithServerVersion(null);
    expect(badge(el)).toBeNull();
    // Header still rendered, so the layout didn't crash mid-render.
    expect(el.shadowRoot!.querySelector(".header-title-text")).not.toBeNull();
  });

  test("shows Dev for a dev backend", async () => {
    el = await renderWithServerVersion("0.0.0");
    expect(badge(el)?.textContent?.trim()).toBe("Dev");
  });

  test("shows Beta for a pre-release backend", async () => {
    el = await renderWithServerVersion("0.1.0b117");
    expect(badge(el)?.textContent?.trim()).toBe("Beta");
  });

  test("shows no badge for a stable backend", async () => {
    el = await renderWithServerVersion("1.0.0");
    expect(badge(el)).toBeNull();
  });
});
