// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";

import "../_mock-webawesome.js";

import { ESPHomeBaseDialog } from "../../src/components/base-dialog.js";
import { commandDialogStyles } from "../../src/components/command-dialog/styles.js";
import { firmwareInstallDialogStyles } from "../../src/components/firmware-install-dialog/styles.js";
import { primaryHeaderDialogStyles } from "../../src/styles/dialog-chrome.js";
import { primaryDialogHeaderStyles } from "../../src/styles/dialog-header.js";
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

/**
 * Every fixed-height 40px header band must opt its title back into
 * single-line ellipsis, or a wrapped title clips against the band. happy-dom
 * does no layout, so pin the rule's presence in each fragment's CSS text —
 * this is the half of the #1331 fix that shipped incomplete the first time
 * (the two inline bands were missed).
 */
describe("fixed-height header bands keep titles single-line", () => {
  const bands = [
    ["primaryDialogHeaderStyles", primaryDialogHeaderStyles],
    ["primaryHeaderDialogStyles", primaryHeaderDialogStyles],
    ["commandDialogStyles", commandDialogStyles],
    ["firmwareInstallDialogStyles", firmwareInstallDialogStyles],
  ] as const;

  test.each(bands)("%s re-adds nowrap on ::part(title-text)", (_name, styles) => {
    expect(styles.cssText).toMatch(/::part\(title-text\)\s*\{[^}]*white-space:\s*nowrap/);
  });
});
