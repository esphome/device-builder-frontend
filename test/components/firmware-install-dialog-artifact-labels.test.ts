/**
 * @vitest-environment happy-dom
 *
 * The picker maps the backend's stable artifact `type` to a localized label,
 * and falls back to the platform-supplied title/description when there's no
 * translation (unknown type, or a type without a key). Uses the real English
 * localize so the localized path is actually exercised.
 */
import { render } from "lit";
import { describe, expect, it } from "vitest";
import type { FirmwareBinary } from "../../src/api/types/firmware-jobs.js";
import { defaultLocalize } from "../../src/common/localize.js";
import type { ESPHomeFirmwareInstallDialog } from "../../src/components/firmware-install-dialog.js";
import { renderStatus } from "../../src/components/firmware-install-dialog/renderers.js";

function rowsText(binaries: FirmwareBinary[]): string {
  const host = {
    _step: "choose-binary",
    _binaries: binaries,
    _localize: defaultLocalize,
    _onChooseBinary: () => {},
  };
  const container = document.createElement("div");
  render(renderStatus(host as unknown as ESPHomeFirmwareInstallDialog), container);
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
});
