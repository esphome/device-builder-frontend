/**
 * Pins the footer affordance for the binary-download picker: the
 * choose-binary and downloading steps must offer Close (the _close
 * handler), never the Stop button (_cancel), which targets a
 * compile/follow-job that is already finished. A regression that folds
 * "downloading" back into the isRunning branch would resurface a dead
 * Stop button mid-download.
 */
import { describe, expect, it, vi } from "vitest";

const { isWebUsbSupported } = vi.hoisted(() => ({
  isWebUsbSupported: vi.fn(() => true),
}));
vi.mock("../../src/platforms/rp2/web-usb.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isWebUsbSupported,
}));

import { identityLocalize } from "../_dom.js";
import { findTemplatesByAnchor, visitTemplates } from "../_lit-template-walker.js";
import type {
  ESPHomeFirmwareInstallDialog,
  InstallFailureKind,
} from "../../src/components/firmware-install-dialog.js";
import {
  flasherStepView,
  renderFooter,
} from "../../src/components/firmware-install-dialog/renderers.js";
import {
  nrfDfuInstall,
  nrfDoFlash,
  nrfDoReset,
} from "../../src/platforms/nrf52/dashboard.js";
import {
  type AnyBrowserInstall,
  FLASH_ACTION_KEY,
  RESET_ACTION_KEY,
} from "../../src/platforms/platform-support.js";
import {
  rp2DoDownload,
  rp2DoFlash,
  rp2DoReset,
  rp2Uf2Install,
} from "../../src/platforms/rp2/dashboard.js";
import { rtlAmbz2Install, rtlDoFlash } from "../../src/platforms/rtl87xx/dashboard.js";

function footerHost(step: string) {
  return {
    _step: step,
    _installer: "binary-download",
    _localize: identityLocalize,
    _close: vi.fn(),
    _cancel: vi.fn(),
    _retry: vi.fn(),
    _showLogsAgain: vi.fn(),
    _detected: null,
    _failureKind: null as InstallFailureKind,
    _tryChangeBoard: vi.fn(),
    _showLogsAfterInstall: false,
    _toggleShowLogsAfterInstall: vi.fn(),
    _flashBusy: false,
    _flasher: null as AnyBrowserInstall | null,
    _logsPort: null as SerialPort | null,
  };
}

// The platform functions a flasher step's buttons run, secondary first.
function stepRuns(host: ReturnType<typeof footerHost>) {
  const footer = flasherStepView(
    host as unknown as ESPHomeFirmwareInstallDialog
  )?.footer?.();
  return [footer?.secondary?.run, footer?.primary.run].filter(Boolean);
}

const footerValues = (host: ReturnType<typeof footerHost>) =>
  findTemplatesByAnchor(
    renderFooter(host as unknown as ESPHomeFirmwareInstallDialog),
    'class="footer"'
  ).flatMap((t) => t.values);

// The bootloader-step footer nests its optional button in a sub-template.
const footerValuesDeep = (host: ReturnType<typeof footerHost>) => {
  const values: unknown[] = [];
  visitTemplates(renderFooter(host as unknown as ESPHomeFirmwareInstallDialog), (t) =>
    values.push(...t.values)
  );
  return values;
};

describe("firmware-install-dialog footer", () => {
  it.each(["rp2-bootsel", "rp2-wait"])(
    "offers Close, Reset Device and Flash on the %s step with WebUSB",
    (step) => {
      isWebUsbSupported.mockReturnValue(true);
      const host = footerHost(step);
      host._flasher = rp2Uf2Install;
      const values = footerValuesDeep(host);
      expect(values).toContain(host._close);
      expect(values).toContain(RESET_ACTION_KEY);
      expect(values).toContain(FLASH_ACTION_KEY);
      expect(values).not.toContain(host._cancel);
      expect(stepRuns(host)).toEqual([rp2DoReset, rp2DoFlash]);
    }
  );

  it("offers Flash beside Reset Device on the nrf-reset step, for a device already in DFU", () => {
    const host = footerHost("nrf-reset");
    host._flasher = nrfDfuInstall;
    const values = footerValuesDeep(host);
    expect(values).toContain(host._close);
    expect(values).toContain(RESET_ACTION_KEY);
    expect(values).toContain(FLASH_ACTION_KEY);
    expect(values).not.toContain(host._cancel);
    expect(stepRuns(host)).toEqual([nrfDoFlash, nrfDoReset]);
  });

  it("offers Flash alone on the nrf-wait step", () => {
    const host = footerHost("nrf-wait");
    host._flasher = nrfDfuInstall;
    const values = footerValuesDeep(host);
    expect(values).toContain(FLASH_ACTION_KEY);
    expect(values).not.toContain(RESET_ACTION_KEY);
    expect(stepRuns(host)).toEqual([nrfDoFlash]);
  });

  it("offers Flash alone on the rtl-ready step", () => {
    const host = footerHost("rtl-ready");
    host._flasher = rtlAmbz2Install;
    const values = footerValuesDeep(host);
    expect(values).toContain(FLASH_ACTION_KEY);
    expect(values).not.toContain(host._cancel);
    expect(stepRuns(host)).toEqual([rtlDoFlash]);
  });

  it("keeps Stop on a flasher step without buttons (rtl-connect)", () => {
    const host = footerHost("rtl-connect");
    host._flasher = rtlAmbz2Install;
    expect(footerValues(host)).toContain(host._cancel);
  });

  it("swaps Flash for Download UF2 without WebUSB (Firefox)", () => {
    isWebUsbSupported.mockReturnValue(false);
    const host = footerHost("rp2-bootsel");
    host._flasher = rp2Uf2Install;
    const values = footerValuesDeep(host);
    expect(values).toContain("firmware.rp2_download_action");
    expect(values).not.toContain(FLASH_ACTION_KEY);
    expect(stepRuns(host)).toEqual([rp2DoReset, rp2DoDownload]);
  });

  it("offers Retry on a Pico flash failure", () => {
    const host = footerHost("error");
    host._installer = "rp2-uf2";
    expect(footerValues(host)).toContain(host._retry);
  });

  it.each(["choose-binary", "downloading"])(
    "offers Close and not Stop on the %s step",
    (step) => {
      const host = footerHost(step);
      const values = footerValues(host);
      expect(values).toContain(host._close);
      expect(values).not.toContain(host._cancel);
    }
  );

  it("still offers Stop while a cancelable job runs (compiling)", () => {
    const host = footerHost("compiling");
    const values = footerValues(host);
    expect(values).toContain(host._cancel);
  });

  it("offers Retry and Close on a Web Serial flash failure", () => {
    const host = footerHost("error");
    host._installer = "web-serial";
    const values = footerValues(host);
    expect(values).toContain(host._retry);
    expect(values).toContain(host._close);
  });

  it("does not offer Retry when the Web Serial failure was during compile", () => {
    // Compile/validate failures show the reset-build hint instead; re-flashing
    // wouldn't address them, so it falls through to the plain Close footer.
    const host = footerHost("error");
    host._installer = "web-serial";
    host._failureKind = "compile";
    const values = footerValues(host);
    expect(values).not.toContain(host._retry);
  });

  it("does not offer Retry on a non-Web-Serial error", () => {
    const host = footerHost("error"); // binary-download
    const values = footerValues(host);
    expect(values).not.toContain(host._retry);
  });

  it("offers Change board and not Retry on a chip mismatch", () => {
    // Retry would loop on the same stale board_id; the reselect hand-off
    // is the only way out.
    const host = footerHost("error");
    host._installer = "web-serial";
    host._failureKind = "chip-mismatch";
    const values = footerValues(host);
    expect(values).toContain(host._tryChangeBoard);
    expect(values).toContain(host._close);
    expect(values).not.toContain(host._retry);
  });

  it("offers only Close on an unsupported-browser decline (web-flash)", () => {
    // Retry would recompile and re-open a tab that declines again for the
    // same reason; a widening of canRetry's failureKind check would silently
    // restore that no-op loop. The default footer nests Close inside a
    // ternary sub-template, so collect values recursively.
    const host = footerHost("error");
    host._installer = "web-flash";
    host._failureKind = "unsupported-browser";
    const values: unknown[] = [];
    visitTemplates(renderFooter(host as unknown as ESPHomeFirmwareInstallDialog), (t) =>
      values.push(...t.values)
    );
    expect(values).toContain(host._close);
    expect(values).not.toContain(host._retry);
    expect(values).not.toContain(host._tryChangeBoard);
  });

  it("offers Show logs on Done when the flow can pick the logs port", () => {
    const host = footerHost("done");
    host._flasher = rp2Uf2Install;
    expect(footerValuesDeep(host)).toContain(host._showLogsAgain);
  });

  it("offers only Close on Done when there is no port and no way to pick one", () => {
    const host = footerHost("done");
    host._flasher = rtlAmbz2Install;
    expect(footerValuesDeep(host)).not.toContain(host._showLogsAgain);
  });
});
