// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";

// Stub the real wa-dialog (happy-dom can't run its form-associated close
// button); this test only exercises the wrapper's own header markup.
import { vi } from "vitest";
vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));

import { ESPHomeBaseDialog } from "../../src/components/base-dialog.js";
import { mount } from "../_dom.js";

/**
 * Pins that the default dialog title wraps instead of ellipsizing
 * (esphome/device-builder-frontend#1331): the title span must not carry the
 * single-line ``.truncate`` class. Fixed-height header bars re-add nowrap via
 * ``::part(title-text)`` in dialog-header.ts / dialog-chrome.ts.
 */
describe("esphome-base-dialog title wrapping", () => {
  test("title span does not carry the truncate class", async () => {
    const el = await mount(new ESPHomeBaseDialog(), {
      label: "Prepare your Raspberry Pi Pico W for first use",
    });
    const title = el.shadowRoot!.querySelector('[part="title-text"]')!;
    expect(title.classList.contains("truncate")).toBe(false);
  });
});
