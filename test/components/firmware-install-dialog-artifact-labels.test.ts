/**
 * @vitest-environment happy-dom
 *
 * The picker maps the backend's stable artifact `type` to a localized label,
 * and falls back to the platform-supplied title/description when there's no
 * translation (unknown type, or a type without a key). Uses the real English
 * localize so the localized path is actually exercised.
 */
import { describe, expect, it, vi } from "vitest";
import { renderInto } from "../_dom.js";
import { fakeLogBuffer } from "../_fake-host.js";
import type { FirmwareBinary } from "../../src/api/types/firmware-jobs.js";
import { defaultLocalize } from "../../src/common/localize.js";
import type { ESPHomeFirmwareInstallDialog } from "../../src/components/firmware-install-dialog.js";
import { initialChecksums } from "../../src/components/firmware-install-dialog/checksums.js";
import { renderStatusExtra } from "../../src/components/firmware-install-dialog/renderers.js";

const copyWithToast = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../src/util/copy-value.js", () => ({ copyWithToast }));
const downloadBlob = vi.hoisted(() => vi.fn());
vi.mock("../../src/util/download-text.js", async (orig) => ({
  ...(await orig<typeof import("../../src/util/download-text.js")>()),
  downloadBlob,
}));

function renderRows(
  binaries: FirmwareBinary[],
  expanded: string[] = [],
  { building = false, stale = false } = {}
) {
  const host = {
    _step: "choose-binary",
    _binaries: binaries,
    _log: fakeLogBuffer(),
    _localize: defaultLocalize,
    _onChooseBinary: () => {},
    _checksums: {
      ...initialChecksums(),
      expanded: new Set(expanded),
      builds: stale ? 1 : 0,
    },
    _device: { configuration: "kitchen.yaml" },
    _activeJobs: new Map(
      building ? [["kitchen.yaml", { job_id: "j", job_type: "compile" }]] : []
    ),
  };
  const container = renderInto(
    renderStatusExtra(host as unknown as ESPHomeFirmwareInstallDialog)
  );
  return Object.assign(container, { host });
}

function rowsText(binaries: FirmwareBinary[]): string {
  return renderRows(binaries).textContent ?? "";
}

describe("choose-binary artifact labels", () => {
  it("uses the localized label/description for a known type", () => {
    const text = rowsText([
      {
        title: "ELF (for debugging)",
        file: "firmware.elf",
        download_name: "kitchen-firmware.elf",
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
        download_name: "kitchen-x.bin",
        type: "nope",
        description: "backend desc",
      },
    ]);
    expect(text).toContain("Mystery artifact");
    expect(text).toContain("backend desc");
  });

  it("falls back to backend text when no type is present", () => {
    const text = rowsText([
      {
        title: "Factory format (Previously Modern)",
        file: "firmware.factory.bin",
        download_name: "kitchen-firmware.factory.bin",
      },
    ]);
    expect(text).toContain("Factory format (Previously Modern)");
  });

  const OTA_ROW: FirmwareBinary = {
    title: "OTA Update",
    file: "firmware.ota.bin",
    download_name: "kitchen-firmware.ota.bin",
    type: "ota",
    md5: "a".repeat(32),
  };
  const ELF_ROW: FirmwareBinary = {
    title: "ELF (for debugging)",
    file: "firmware.elf",
    download_name: "kitchen-firmware.elf",
    type: "elf",
  };

  it("keeps the MD5 collapsed behind a per-row toggle", () => {
    const container = renderRows([OTA_ROW, ELF_ROW]);

    expect(container.querySelectorAll(".binary-option")).toHaveLength(2);
    const toggles = container.querySelectorAll<HTMLButtonElement>(".disclosure-toggle");
    expect(toggles).toHaveLength(1);
    expect(toggles[0].getAttribute("aria-expanded")).toBe("false");
    expect(toggles[0].getAttribute("aria-label")).toBe("MD5 of OTA update");
    expect(container.textContent).not.toContain(OTA_ROW.md5);
    toggles[0].click();
    expect(container.host._checksums.expanded.has("firmware.ota.bin")).toBe(true);
  });

  it("expanding shows the digest, its copy control and the .md5 download", () => {
    const digest = OTA_ROW.md5!;
    const container = renderRows([OTA_ROW, ELF_ROW], ["firmware.ota.bin"]);

    const copy = container.querySelector<HTMLButtonElement>(".copy-value")!;
    expect(copy.textContent).toContain(digest);
    expect(copy.getAttribute("aria-label")).toBe("Copy the MD5 of OTA update");
    copy.click();
    expect(copyWithToast).toHaveBeenCalledWith(
      defaultLocalize,
      digest,
      expect.objectContaining({
        okKey: "firmware.md5_copied",
        failKey: "firmware.md5_copy_failed",
      })
    );

    const download = container.querySelector<HTMLButtonElement>(
      '[aria-label="Download the .md5 file for OTA update"]'
    )!;
    download.click();
    expect(downloadBlob).toHaveBeenCalledWith(
      `${digest}  kitchen-firmware.ota.bin\n`,
      "kitchen-firmware.ota.bin.md5",
      "text/plain"
    );
  });
  it("hides the digest and its controls while a build runs", () => {
    const container = renderRows([OTA_ROW], ["firmware.ota.bin"], { building: true });
    expect(container.querySelector(".copy-value")).toBeNull();
    expect(container.textContent).not.toContain(OTA_ROW.md5);
    expect(container.textContent).toContain("A build is running");
  });

  it("asks to reopen once a build made the listed digests stale", () => {
    const container = renderRows([OTA_ROW], ["firmware.ota.bin"], { stale: true });
    expect(container.querySelector(".copy-value")).toBeNull();
    expect(container.textContent).toContain("Reopen the download");
  });

  it("shows the recorded row's MD5 on download-ready", () => {
    const host = {
      _step: "download-ready",
      _installer: "binary-download",
      // The live row differs; download-ready renders the recorded one.
      _binaries: [{ ...OTA_ROW, md5: "b".repeat(32) }],
      _downloadedFilename: "renamed-firmware.ota.bin",
      _log: fakeLogBuffer(),
      _localize: defaultLocalize,
      _checksums: {
        ...initialChecksums(),
        expanded: new Set(["firmware.ota.bin"]),
        downloaded: OTA_ROW,
      },
      _activeJobs: new Map(),
    };
    const container = renderInto(
      renderStatusExtra(host as unknown as ESPHomeFirmwareInstallDialog)
    );
    expect(container.querySelector(".copy-value")?.textContent).toContain(OTA_ROW.md5);
  });

  it("keeps the downloaded digest on download-ready while a later build runs", () => {
    const container = renderDownloadReady({ building: true });
    expect(container.querySelector(".copy-value")?.textContent).toContain(OTA_ROW.md5);
  });

  it("shows no checksum on download-ready when the download token had none", () => {
    const container = renderDownloadReady({ withMd5: false });
    expect(container.querySelector(".copy-value")).toBeNull();
    expect(container.querySelector(".binary-checksum")).toBeNull();
  });

  function renderDownloadReady({ building = false, withMd5 = true } = {}) {
    const host = {
      _step: "download-ready",
      _installer: "binary-download",
      _binaries: [OTA_ROW],
      _downloadedFilename: OTA_ROW.download_name,
      _log: fakeLogBuffer(),
      _localize: defaultLocalize,
      _device: { configuration: "kitchen.yaml" },
      _activeJobs: new Map(
        building ? [["kitchen.yaml", { job_id: "j", job_type: "compile" }]] : []
      ),
      _checksums: {
        ...initialChecksums(),
        expanded: new Set(["firmware.ota.bin"]),
        downloaded: withMd5 ? OTA_ROW : { ...OTA_ROW, md5: undefined },
      },
    };
    return renderInto(renderStatusExtra(host as unknown as ESPHomeFirmwareInstallDialog));
  }
});
