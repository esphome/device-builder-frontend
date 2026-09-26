/**
 * @vitest-environment happy-dom
 *
 * The board step's detection preset (#1856): a whole-platform preset
 * narrows the catalog fetch to the platform and names its chips in the
 * banner; a chip click or "Show all boards" leaves detection mode.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/badge/badge.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("../../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/util/web-serial.js")>()),
  isWebSerialSupported: () => false,
}));

import { defaultLocalize } from "../../../src/common/localize.js";
import type { WizardBoardPreset } from "../../../src/components/wizard/wizard-step-board-platforms.js";
import { ESPHomeWizardStepBoard } from "../../../src/components/wizard/wizard-step-board.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function mount(preset: WizardBoardPreset | null) {
  const el = new ESPHomeWizardStepBoard();
  const getBoards = vi.fn(async () => ({ boards: [], total: 0 }));
  (el as any)._localize = defaultLocalize;
  (el as any)._api = { getBoards, getSerialPorts: async () => [] };
  el.preset = preset;
  document.body.appendChild(el);
  await settle(el);
  return { el, getBoards };
}

// The list's first fetch resolves after the first render; let it land.
async function settle(el: ESPHomeWizardStepBoard) {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }
}

const banner = (el: ESPHomeWizardStepBoard) =>
  el
    .shadowRoot!.querySelector(".detection-banner")
    ?.textContent?.replace(/\s+/g, " ")
    .trim();
const lastFetch = (getBoards: ReturnType<typeof vi.fn>) =>
  getBoards.mock.calls[getBoards.mock.calls.length - 1][0] as Record<string, unknown>;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("wizard-step-board detection preset", () => {
  it("narrows the fetch to a whole platform and names its chips", async () => {
    const { el, getBoards } = await mount({ label: "RP2040 / RP2350", platform: "rp2" });
    expect(lastFetch(getBoards)).toMatchObject({ platform: "rp2", mcu: undefined });
    expect(banner(el)).toContain("RP2040 / RP2350");
    // Detection mode hides the chip row.
    expect(el.shadowRoot!.querySelector(".platform-chip")).toBeNull();
  });

  it("narrows to one chip for a chip preset", async () => {
    const { el, getBoards } = await mount({ label: "RP2350" });
    expect(lastFetch(getBoards)).toMatchObject({ platform: "rp2", mcu: "rp2350" });
    expect(banner(el)).toContain("RP2350");
  });

  it("leaves the platform behind on Show all boards", async () => {
    const { el, getBoards } = await mount({ label: "RP2040 / RP2350", platform: "rp2" });
    (
      el.shadowRoot!.querySelector(".detection-banner button") as HTMLButtonElement
    ).click();
    await el.updateComplete;
    expect(lastFetch(getBoards)).toMatchObject({ platform: undefined });
    expect(banner(el)).toBeUndefined();
  });

  it("leaves the platform behind on a chip click", async () => {
    const { el, getBoards } = await mount({ label: "RP2040 / RP2350", platform: "rp2" });
    (el as any)._onPlatformFilter("ESP8266");
    await settle(el);
    expect(lastFetch(getBoards)).toMatchObject({ platform: "esp8266" });
    expect(banner(el)).toBeUndefined();
  });

  it("takes the next board's detection when the step is re-opened for it", async () => {
    // The step stays mounted inside the dialog, so "Set it up" for a second
    // board hands it a new preset in place.
    const { el, getBoards } = await mount({ label: "ESP32-S3" });
    expect(banner(el)).toContain("ESP32-S3");
    el.preset = { label: "RP2040 / RP2350", platform: "rp2" };
    await settle(el);
    expect(lastFetch(getBoards)).toMatchObject({ platform: "rp2", variant: undefined });
    expect(banner(el)).toContain("RP2040 / RP2350");
  });

  it("shows the full picker again when re-opened without a detection", async () => {
    const { el, getBoards } = await mount({ label: "ESP32-S3" });
    el.preset = null;
    await settle(el);
    expect(lastFetch(getBoards)).toMatchObject({ platform: undefined });
    expect(banner(el)).toBeUndefined();
  });
});
