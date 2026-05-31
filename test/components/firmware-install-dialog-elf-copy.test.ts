/**
 * @vitest-environment happy-dom
 *
 * The download-ready success copy must match the artefact: the ELF is debug
 * symbols for the stack trace decoder, not a flashable image, so it gets its
 * own title/body instead of the firmware "flash it to your device" wording.
 */
import { render } from "lit";
import { describe, expect, it } from "vitest";
import type { ESPHomeFirmwareInstallDialog } from "../../src/components/firmware-install-dialog.js";
import { renderStatus } from "../../src/components/firmware-install-dialog/renderers.js";

function textFor(filename: string): string {
  const host = {
    _step: "download-ready",
    _installer: "binary-download",
    _downloadedFilename: filename,
    _binaries: [],
    _localize: (key: string) => key,
  };
  const container = document.createElement("div");
  render(renderStatus(host as unknown as ESPHomeFirmwareInstallDialog), container);
  return container.textContent ?? "";
}

describe("download-ready success copy", () => {
  it("uses ELF-specific copy for a .elf download", () => {
    const text = textFor("kitchen-firmware.elf");
    expect(text).toContain("firmware.elf_download_done_title");
    expect(text).not.toContain("firmware.binary_download_done_title");
  });

  it("uses firmware copy for a flashable image", () => {
    const text = textFor("kitchen-firmware.factory.bin");
    expect(text).toContain("firmware.binary_download_done_title");
    expect(text).not.toContain("firmware.elf_download_done_title");
  });
});
