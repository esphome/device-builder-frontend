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

function renderRows(
  binaries: FirmwareBinary[],
  onChooseBinary: (file: string) => void = () => {},
  onCopyMd5: (digest: string) => void = () => {}
) {
  const host = {
    _step: "choose-binary",
    _binaries: binaries,
    _log: fakeLogBuffer(),
    _localize: defaultLocalize,
    _onChooseBinary: onChooseBinary,
    _copyMd5: onCopyMd5,
  };
  return renderInto(renderStatusExtra(host as unknown as ESPHomeFirmwareInstallDialog));
}

function rowsText(binaries: FirmwareBinary[]): string {
  const container = renderRows(binaries);
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

  it("shows MD5 copy and sidecar download actions beside each firmware", () => {
    const digest = "a".repeat(32);
    const elfDigest = "b".repeat(32);
    const selected: string[] = [];
    const copied: string[] = [];
    const container = renderRows(
      [
        {
          title: "OTA Update",
          file: "firmware.ota.bin",
          type: "ota",
          md5: digest,
        },
        {
          title: "ELF (for debugging)",
          file: "firmware.elf",
          type: "elf",
          md5: elfDigest,
        },
        {
          title: "MD5 checksum for OTA Update",
          file: "firmware.ota.bin.md5",
          type: "md5",
          description: digest,
        },
        {
          title: "MD5 checksum for ELF (for debugging)",
          file: "firmware.elf.md5",
          type: "md5",
          description: elfDigest,
        },
      ],
      (file) => selected.push(file),
      (value) => copied.push(value)
    );
    const text = container.textContent ?? "";

    expect(text).toContain(`MD5: ${digest}`);
    expect(text).toContain(`MD5: ${elfDigest}`);
    expect(text).toContain("ELF (debug symbols)");
    expect(text).not.toContain("MD5 checksum for OTA update");
    const copyButtons = container.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Copy MD5"]'
    );
    copyButtons.forEach((button) => button.click());
    expect(copied).toEqual([digest, elfDigest]);
    const downloadButtons = container.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Download .md5"]'
    );
    downloadButtons.forEach((button) => button.click());
    expect(selected).toEqual(["firmware.ota.bin.md5", "firmware.elf.md5"]);
  });
});
