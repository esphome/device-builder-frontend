import { JobStatus } from "../../api/types.js";
import { chipNameToVariant } from "../../util/chip-variant.js";
import { downloadBase64Binary } from "../../util/download-text.js";
import { dispatchShowLogsAfterInstall } from "../../util/post-install-logs.js";
import {
  connectToPort,
  detectChip,
  disconnect,
  flashFirmware,
  resetAndDisconnect,
  type DetectedChip,
} from "../../util/web-serial.js";
import type { ESPHomeFirmwareInstallDialog } from "../firmware-install-dialog.js";

// Dashboard mode pins escaped form (\033[…m); raw branch is defensive.
const ANSI_SGR = /(?:\\033|\x1b)\[[0-9;]*m/g;
const LOADER_ERROR = /^(?:\d{2}:\d{2}:\d{2}\s+)?ERROR Error while reading config:/;

// "Failed config" — bold-red schema-validator banner; ERROR-prefixed line is
// the YAML-load step's _LOGGER.error. Both mean the build never reached C++.
export function isValidationFailureLine(line: string): boolean {
  const stripped = line.replace(ANSI_SGR, "").trim();
  if (stripped === "Failed config") return true;
  return LOADER_ERROR.test(stripped);
}

export function compileFailureDetail(err: unknown): string {
  return err instanceof Error ? err.message.trim() : String(err ?? "").trim();
}

export async function startWebSerialInstall(
  host: ESPHomeFirmwareInstallDialog,
): Promise<void> {
  const device = host._device;
  if (!device) return;

  // 1. Connect and detect chip
  let detected: DetectedChip;
  try {
    detected = await detectChip();
  } catch {
    host._close(); // User cancelled port selection
    return;
  }
  host._detected = detected;

  // 2. Verify chip matches platform. device.target_platform only carries the
  // YAML's top-level platform — every ESP32 variant reports as plain "esp32"
  // until the first compile fills in specifics. Resolve the actual variant
  // via the board catalog and only strict-compare when we have authoritative info.
  host._statusMessage = host._localize("firmware.status_verifying");
  const detectedVariant = chipNameToVariant(detected.chipName);
  let expected = device.target_platform;
  let hasAuthoritativeVariant = false;
  if (device.board_id) {
    try {
      const board = await host._api.getBoard(device.board_id);
      const variant = board?.esphome.variant ?? board?.esphome.platform;
      if (variant) {
        expected = variant;
        hasAuthoritativeVariant = true;
      }
    } catch {
      // Network hiccup — fall back to target_platform.
    }
  }
  const expectedNorm = expected ? expected.toLowerCase().replace(/-/g, "") : "";
  // Without a resolved variant, "esp32" stands in for any ESP32 family chip.
  const expectedIsCoarseEsp32 = !hasAuthoritativeVariant && expectedNorm === "esp32";
  if (
    expectedNorm &&
    expectedNorm !== "unknown" &&
    detectedVariant !== expectedNorm &&
    !(expectedIsCoarseEsp32 && detectedVariant.startsWith("esp32"))
  ) {
    try {
      await disconnect(detected.transport);
    } catch {
      /* ignore */
    }
    host._fail(
      host._localize("firmware.chip_mismatch", {
        detected: detected.chipName,
        expected,
      }),
    );
    return;
  }

  // Disconnect during compile — we'll reconnect to flash.
  try {
    await disconnect(detected.transport);
  } catch {
    /* ignore */
  }

  // 3. Compile
  host._step = "queued";
  host._statusMessage = host._localize("firmware.status_queued");
  try {
    await compileAndWait(host, device.configuration);
  } catch (err) {
    host._failedDuringCompile = true;
    host._fail(host._localize("firmware.compile_failed"), compileFailureDetail(err));
    return;
  }

  // 4. Download binary
  host._statusMessage = host._localize("firmware.status_downloading");
  let firmwareBytes: Uint8Array;
  let flashAddress = 0x10000;
  try {
    const binaries = await host._api.firmwareGetBinaries(device.configuration);
    // Prefer factory binary (flashes at 0x0, includes bootloader).
    const factory = binaries.find((b) => b.file.includes("factory"));
    const binary = factory || binaries[0];
    if (!binary) {
      host._fail(host._localize("serial.no_firmware"));
      return;
    }
    if (factory) flashAddress = 0x0;
    const result = await host._api.firmwareDownload(device.configuration, binary.file);
    firmwareBytes = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
  } catch {
    host._fail(host._localize("firmware.download_failed"));
    return;
  }

  // 5. Reconnect (no browser picker) and flash.
  host._step = "flashing";
  host._statusMessage = host._localize("firmware.status_flashing");
  host._flashPercent = 0;
  let flashDetected: DetectedChip;
  try {
    flashDetected = await connectToPort(detected.port);
  } catch (err) {
    console.error("[Web Serial] Reconnect failed:", err);
    host._fail(host._localize("firmware.flash_failed"));
    return;
  }

  try {
    await flashFirmware(flashDetected.loader, firmwareBytes, flashAddress, (p) => {
      host._flashPercent = p.percent;
    });
  } catch (err) {
    console.error("[Web Serial] Flash error:", err);
    // 100% reached: treat as success — device may have reset during verification.
    if (host._flashPercent < 100) {
      try {
        await disconnect(flashDetected.transport);
      } catch {
        /* ignore */
      }
      host._fail(
        err instanceof Error ? err.message : host._localize("firmware.flash_failed"),
      );
      return;
    }
  }

  // 6. Reset
  host._statusMessage = host._localize("firmware.status_resetting");
  try {
    await resetAndDisconnect(
      flashDetected.loader,
      flashDetected.transport,
      flashDetected.port,
    );
  } catch {
    /* ignore reset errors */
  }

  host._statusMessage = host._localize("firmware.status_done");
  host._step = "done";
  // _cancel closes the UI but doesn't interrupt the flash loop — a dismissed
  // install can still reach here, so gate the auto-flip on the dialog still
  // being open. Otherwise the logs viewer pops up on a user who walked away.
  if (host._open && host._showLogsAfterInstall) {
    flipToLogs(host, flashDetected.port);
  }
}

export function flipToLogs(
  host: ESPHomeFirmwareInstallDialog,
  webSerialPort: SerialPort,
): void {
  const device = host._device;
  if (!device) return;
  const handled = dispatchShowLogsAfterInstall(host, {
    configuration: device.configuration,
    name: device.friendly_name || device.name,
    webSerialPort,
    reopenInstall: () => host.reopen(),
  });
  if (handled) host._open = false;
}

// Shared compile + save for web.esphome.io and manual binary download. Differ
// in which binaries are eligible — web.esphome.io needs a self-contained image
// (factory.bin / firmware.bin); manual gives whatever artefact was produced
// (including .uf2 for RP2040 / nrf52 / libretiny).
export async function startDownload(
  host: ESPHomeFirmwareInstallDialog,
): Promise<void> {
  const device = host._device;
  if (!device) return;
  const isWebFlasher = host._installer === "web-download";

  try {
    await compileAndWait(host, device.configuration);
  } catch (err) {
    host._failedDuringCompile = true;
    host._fail(host._localize("firmware.compile_failed"), compileFailureDetail(err));
    return;
  }

  host._statusMessage = host._localize("firmware.status_downloading");
  try {
    const binaries = await host._api.firmwareGetBinaries(device.configuration);
    // ESP32 → firmware.factory.bin (bootloader + partitions + app)
    // ESP8266 → firmware.bin (full image, no bootloader split)
    // web flasher requires one of those; manual falls back to first available.
    const flashable =
      binaries.find((b) => b.file === "firmware.factory.bin") ??
      binaries.find((b) => b.file === "firmware.bin") ??
      (isWebFlasher ? undefined : binaries[0]);
    if (!flashable) {
      // Web-flasher path with no match almost always = UF2 platform.
      host._fail(
        host._localize(
          isWebFlasher ? "firmware.no_flashable_binary" : "firmware.no_binaries",
        ),
      );
      return;
    }
    const result = await host._api.firmwareDownload(
      device.configuration,
      flashable.file,
    );
    downloadBase64Binary(result.data, result.filename);
    host._downloadedFilename = result.filename;
  } catch {
    host._fail(host._localize("firmware.download_failed"));
    return;
  }

  host._step = "download-ready";
  host._statusMessage = "";
}

export function compileAndWait(
  host: ESPHomeFirmwareInstallDialog,
  configuration: string,
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    // Capture reject on the dialog so a mid-flight detach (header-X / Escape /
    // reopen) can settle this promise. followJob callbacks clear the hook to
    // null on fire so a normal completion doesn't double-reject on teardown.
    host._compileReject = reject;
    try {
      const job = await host._api.firmwareCompile(configuration);
      host._jobId = job.job_id;
      host._streamId = host._api.firmwareFollowJob(job.job_id, {
        onOutput: (line) => {
          if (host._step === "queued") {
            host._step = "compiling";
            host._statusMessage = host._localize("firmware.status_compiling");
          }
          host._logLines = [...host._logLines, line];
          if (isValidationFailureLine(line)) host._failedDuringValidate = true;
        },
        onResult: (data) => {
          host._streamId = "";
          host._jobId = "";
          host._compileReject = null;
          const result = data as unknown as {
            status: string;
            error?: string | null;
          };
          if (result.status === JobStatus.COMPLETED) {
            resolve();
            return;
          }
          // Prefer backend's specific error text so the banner names the cause
          // ("remote build: peer-link session lost (transport_error: …)")
          // instead of a generic "Install failed.".
          reject(new Error(result.error || ""));
        },
        onError: (error) => {
          host._streamId = "";
          host._jobId = "";
          host._compileReject = null;
          reject(new Error(error));
        },
      });
    } catch (err) {
      host._compileReject = null;
      reject(err);
    }
  });
}
