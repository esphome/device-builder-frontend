/**
 * The download-ready success copy must match the artefact: the ELF is debug
 * symbols for the stack trace decoder, not a flashable image, so it gets its
 * own title/body instead of the firmware "flash it to your device" wording.
 * The copy now flows through the card status message/detail the dialog feeds
 * to <esphome-process-terminal>.
 */
import { describe, expect, it } from "vitest";
import type { ESPHomeFirmwareInstallDialog } from "../../src/components/firmware-install-dialog.js";
import {
  cardStatusDetail,
  cardStatusMessage,
} from "../../src/components/firmware-install-dialog/renderers.js";
import { identityLocalize } from "../_dom.js";

function textFor(filename: string): string {
  const host = {
    _step: "download-ready",
    _installer: "binary-download",
    _downloadedFilename: filename,
    _binaries: [],
    _localize: identityLocalize,
  } as unknown as ESPHomeFirmwareInstallDialog;
  return `${cardStatusMessage(host)} ${cardStatusDetail(host)}`;
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
