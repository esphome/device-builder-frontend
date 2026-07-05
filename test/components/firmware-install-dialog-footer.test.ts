/**
 * Pins the footer affordance for the binary-download picker: the
 * choose-binary and downloading steps must offer Close (the _close
 * handler), never the Stop button (_cancel), which targets a
 * compile/follow-job that is already finished. A regression that folds
 * "downloading" back into the isRunning branch would resurface a dead
 * Stop button mid-download.
 */
import { describe, expect, it, vi } from "vitest";
import type { ESPHomeFirmwareInstallDialog } from "../../src/components/firmware-install-dialog.js";
import { renderFooter } from "../../src/components/firmware-install-dialog/renderers.js";
import { identityLocalize } from "../_dom.js";
import { findTemplatesByAnchor } from "../_lit-template-walker.js";

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
    _failedDuringCompile: false,
    _failedDuringValidate: false,
    _showLogsAfterInstall: false,
    _toggleShowLogsAfterInstall: vi.fn(),
  };
}

const footerValues = (host: ReturnType<typeof footerHost>) =>
  findTemplatesByAnchor(
    renderFooter(host as unknown as ESPHomeFirmwareInstallDialog),
    'class="footer"'
  ).flatMap((t) => t.values);

describe("firmware-install-dialog footer", () => {
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
    host._failedDuringCompile = true;
    const values = footerValues(host);
    expect(values).not.toContain(host._retry);
  });

  it("does not offer Retry on a non-Web-Serial error", () => {
    const host = footerHost("error"); // binary-download
    const values = footerValues(host);
    expect(values).not.toContain(host._retry);
  });
});
