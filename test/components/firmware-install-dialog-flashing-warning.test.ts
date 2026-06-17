/**
 * During a Web Serial flash (the `flashing` step) the status subtext warns the
 * user to keep the window visible — a hidden tab throttles timers and can stall
 * the write. Other steps carry no such warning.
 */
import { describe, expect, it } from "vitest";
import { defaultLocalize } from "../../src/common/localize.js";
import type { ESPHomeFirmwareInstallDialog } from "../../src/components/firmware-install-dialog.js";
import { cardStatusDetail } from "../../src/components/firmware-install-dialog/renderers.js";

const host = (step: string): ESPHomeFirmwareInstallDialog =>
  ({
    _step: step,
    _errorMessage: "",
    _localize: defaultLocalize,
  }) as unknown as ESPHomeFirmwareInstallDialog;

describe("cardStatusDetail flashing warning", () => {
  it("warns to keep the window visible during a Web Serial flash", () => {
    const detail = cardStatusDetail(host("flashing"));
    expect(detail).toBe(defaultLocalize("firmware.flashing_keep_visible"));
    expect(detail).toContain("Keep this window visible");
  });

  it("adds no warning on non-flashing steps", () => {
    // The restart phase keeps _step === "flashing" (only the status message
    // changes), so the warning correctly persists there; test genuine
    // non-flashing steps instead.
    expect(cardStatusDetail(host("connecting"))).toBe("");
    expect(cardStatusDetail(host("queued"))).toBe("");
    expect(cardStatusDetail(host("downloading"))).toBe("");
  });
});
