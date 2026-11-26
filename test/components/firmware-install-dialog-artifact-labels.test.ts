/**
 * @vitest-environment happy-dom
 *
 * The picker maps the backend's stable artifact `type` to a localized label,
 * and falls back to the platform-supplied title/description when there's no
 * translation (unknown type, or a type without a key). Uses the real English
 * localize so the localized path is actually exercised.
 */
import { describe, expect, it } from "vitest";
import { renderInto } from "../_dom.js";
import { fakeLogBuffer } from "../_fake-host.js";
import type { FirmwareBinary } from "../../src/api/types/firmware-jobs.js";
import { defaultLocalize } from "../../src/common/localize.js";
import type { ESPHomeFirmwareInstallDialog } from "../../src/components/firmware-install-dialog.js";
import { renderStatusExtra } from "../../src/components/firmware-install-dialog/renderers.js";

function rowsText(binaries: FirmwareBinary[]): string {
  const host = {
    _step: "choose-binary",
    _binaries: binaries,
    _log: fakeLogBuffer(),
    _localize: defaultLocalize,
    _onChooseBinary: () => {},
  };
  const container = renderInto(
    renderStatusExtra(host as unknown as ESPHomeFirmwareInstallDialog)
  );
  return container.textContent ?? "";
}

describe("choose-binary artifact labels", () => {
  it("uses the localized label/description for a known type", () => {
    const text = rowsText([
      {
        title: "ELF (for debugging)",
        file: "firmware.elf",
        type: "elf",
        description: "backend elf text",
      },
    ]);
    expect(text).toContain("ELF (debug symbols)");
    expect(text).toContain("ESP stack trace decoder");
    expect(text).not.toContain("backend elf text");
  });

  it("falls back to backend text for an unrecognized type", () => {
    const text = rowsText([
      {
        title: "Mystery artifact",
        file: "x.bin",
        type: "nope",
        description: "backend desc",
      },
    ]);
    expect(text).toContain("Mystery artifact");
    expect(text).toContain("backend desc");
  });

  it("falls back to backend text when no type is present", () => {
    const text = rowsText([
      { title: "Factory format (Previously Modern)", file: "firmware.factory.bin" },
    ]);
    expect(text).toContain("Factory format (Previously Modern)");
  });

  function renderDownloadReady(md5: string | undefined) {
    const host = {
      _step: "download-ready",
      _installer: "binary-download",
      _binaries: [],
      _downloadedFilename: "kitchen-firmware.ota.bin",
      _downloadedMd5: md5,
      _log: fakeLogBuffer(),
      _localize: defaultLocalize,
    };
    return renderInto(renderStatusExtra(host as unknown as ESPHomeFirmwareInstallDialog));
  }

  it("shows the downloaded file's MD5 on download-ready", () => {
    const md5 = "a".repeat(32);
    const container = renderDownloadReady(md5);
    expect(container.querySelector(".download-md5 .copy-value")?.textContent).toContain(
      md5
    );
    expect(container.textContent).toContain("Download .md5");
  });

  it("shows no checksum on download-ready without one", () => {
    const container = renderDownloadReady(undefined);
    expect(container.querySelector(".download-md5")).toBeNull();
  });
});
