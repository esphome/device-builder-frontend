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
vi.mock("../../src/util/web-usb.js", () => ({ isWebUsbSupported }));

import { identityLocalize } from "../_dom.js";
import { findTemplatesByAnchor, visitTemplates } from "../_lit-template-walker.js";
import type {
  ESPHomeFirmwareInstallDialog,
  InstallFailureKind,
} from "../../src/components/firmware-install-dialog.js";
import { renderFooter } from "../../src/components/firmware-install-dialog/renderers.js";

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
    _nrfDoReset: vi.fn(),
    _nrfDoFlash: vi.fn(),
    _rp2DoReset: vi.fn(),
    _rp2DoFlash: vi.fn(),
    _rp2DoDownload: vi.fn(),
  };
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
      host._installer = "rp2-uf2";
      const values = footerValuesDeep(host);
      expect(values).toContain(host._close);
      expect(values).toContain(host._rp2DoReset);
      expect(values).toContain(host._rp2DoFlash);
      expect(values).not.toContain(host._rp2DoDownload);
      expect(values).not.toContain(host._cancel);
    }
  );

  it("offers Flash beside Reset Device on the nrf-reset step, for a device already in DFU", () => {
    const host = footerHost("nrf-reset");
    host._installer = "nrf-dfu";
    const values = footerValuesDeep(host);
    expect(values).toContain(host._close);
    expect(values).toContain(host._nrfDoReset);
    expect(values).toContain(host._nrfDoFlash);
    expect(values).not.toContain(host._cancel);
  });

  it("offers Flash alone on the nrf-wait step", () => {
    const host = footerHost("nrf-wait");
    host._installer = "nrf-dfu";
    const values = footerValuesDeep(host);
    expect(values).toContain(host._nrfDoFlash);
    expect(values).not.toContain(host._nrfDoReset);
  });

  it("swaps Flash for Download UF2 without WebUSB (Firefox)", () => {
    isWebUsbSupported.mockReturnValue(false);
    const host = footerHost("rp2-bootsel");
    host._installer = "rp2-uf2";
    const values = footerValuesDeep(host);
    expect(values).toContain(host._rp2DoReset);
    expect(values).toContain(host._rp2DoDownload);
    expect(values).not.toContain(host._rp2DoFlash);
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
});
