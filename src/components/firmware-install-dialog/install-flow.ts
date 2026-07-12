import {
  JobSource,
  JobStatus,
  type FirmwareBinary,
} from "../../api/types/firmware-jobs.js";
import { fetchBoard } from "../../util/board-body-cache.js";
import { chipNameToVariant, chipPlatformFamily } from "../../util/chip-variant.js";
import { triggerDownload } from "../../util/download-text.js";
import { getErrorMessage } from "../../util/error-message.js";
import { formatApiError } from "../../util/format-api-error.js";
import { dispatchShowLogsAfterInstall } from "../../util/post-install-logs.js";
import { openFlasher } from "../../util/usb-flasher.js";
import { isValidationFailureLine } from "../../util/validation-log.js";
import {
  detectChip,
  disconnect,
  flashFirmware,
  isPortPickerCancel,
  resetAndDisconnect,
  UnsupportedChipError,
  type DetectedChip,
} from "../../util/web-serial.js";
import type { ESPHomeFirmwareInstallDialog } from "../firmware-install-dialog.js";
import { OTA_PORT } from "../logs-session.js";

export function compileFailureDetail(err: unknown): string {
  return err instanceof Error ? err.message.trim() : String(err ?? "").trim();
}

/**
 * Choose which binary to flash over Web Serial and its flash offset.
 *
 * ESP8266 / ESP8285 flash a single complete ``firmware.bin`` at 0x0; ESP32 uses
 * a merged ``*.factory.bin`` (bootloader + partitions + app) at 0x0, falling
 * back to the app image at 0x10000. Flashing an ESP8266 image at 0x10000 leaves
 * the boot address empty so the chip never boots (#1529). Returns ``null`` when
 * there's no binary to flash.
 *
 * ``chipName`` is esptool-js's chip *description* (``loader.main()`` returns
 * ``getChipDescription()`` — e.g. ``ESP8266EX`` / ``ESP8285``, not ``ESP8266``),
 * so normalize it via ``chipNameToVariant`` and match the ``esp82`` family.
 *
 * Distinct from ``pickFactoryBinary`` on purpose: Web Serial knows the detected
 * chip and returns a flash offset, with a ``binaries[0]`` fallback. Don't unify.
 */
export function pickFlashTarget(
  chipName: string,
  binaries: FirmwareBinary[]
): { binary: FirmwareBinary; address: number } | null {
  const factory = binaries.find((b) => b.file.includes("factory"));
  const binary = factory ?? binaries[0];
  if (!binary) return null;
  // ESP8266 / ESP8285 are the only "esp82…" family — both flash a single
  // complete image at 0x0, unlike ESP32's app-at-0x10000 layout.
  const isEsp8266 = chipNameToVariant(chipName).startsWith("esp82");
  const atZero = factory !== undefined || isEsp8266;
  return { binary, address: atZero ? 0x0 : 0x10000 };
}

export async function startWebSerialInstall(
  host: ESPHomeFirmwareInstallDialog
): Promise<void> {
  const device = host._device;
  if (!device) return;

  // Surface esptool-js chip-detect / flash-session output in the shared log,
  // the same buffer the compile phase streams to. Without this the WebSerial
  // install showed no esptool logs at all, unlike the OTA / server-serial
  // paths which stream the backend job output (#346).
  const onLog = (line: string) => {
    host._logLines = [...host._logLines, line];
  };

  // 1. Connect and detect chip
  let detected: DetectedChip;
  try {
    detected = await detectChip(onLog);
  } catch (err) {
    if (isPortPickerCancel(err)) {
      host._close();
      return;
    }
    if (err instanceof UnsupportedChipError) {
      host._fail(host._localize("serial.unsupported_chip", { chip: err.chipName }));
      return;
    }
    // The picker succeeded but the chip never answered — fail loud with
    // the esptool log expanded instead of silently closing (#1414).
    host._fail(host._localize("serial.connect_failed"), getErrorMessage(err));
    return;
  }
  host._detected = detected;

  // 2. Verify chip matches platform. device.target_platform only carries the
  // YAML's top-level platform — every ESP32 variant reports as plain "esp32"
  // until the first compile fills in specifics. Resolve the actual variant
  // via the board catalog and only strict-compare when we have authoritative info.
  host._statusMessage = host._localize("firmware.status_verifying");
  // chipPlatformFamily folds esp8285 into esp8266 — they're one ESPHome
  // platform, so an ESP8285 chip on a `board: esp8285` (esp8266) config matches.
  const detectedVariant = chipPlatformFamily(detected.chipName);
  let expected = device.target_platform;
  let hasAuthoritativeVariant = false;
  if (device.board_id) {
    try {
      const board = await fetchBoard(host._api, device.board_id);
      const variant = board?.esphome.variant ?? board?.esphome.platform;
      if (variant) {
        expected = variant;
        hasAuthoritativeVariant = true;
      }
    } catch {
      // Network hiccup — fall back to target_platform.
    }
  }
  // Fold the expected side through the same helper so a board catalog stamping
  // the esp8285 variant still matches a detected ESP8266/ESP8285. Idempotent on
  // an already-normalized platform token.
  const expectedNorm = expected ? chipPlatformFamily(expected) : "";
  // Without a resolved variant, "esp32" stands in for any ESP32 family chip.
  const expectedIsCoarseEsp32 = !hasAuthoritativeVariant && expectedNorm === "esp32";
  if (
    expectedNorm &&
    expectedNorm !== "unknown" &&
    detectedVariant !== expectedNorm &&
    !(expectedIsCoarseEsp32 && detectedVariant.startsWith("esp32"))
  ) {
    await releaseSerial(detected);
    host._fail(
      host._localize("firmware.chip_mismatch", {
        detected: detected.chipName,
        expected,
      })
    );
    return;
  }

  // Keep this esploader session open through the compile and flash on it
  // directly. Closing the port here and reopening it to flash left the stub
  // loader running on the chip while the OS handle was torn down; on boards
  // where DTR/RTS reset doesn't land (ESP32-C3 behind a CH340) the reopened
  // port then reused that stale stub and FLASH_DEFL_BEGIN was rejected with
  // "Failed to enter compressed flash mode" (#1833). The external flasher and
  // the legacy dashboard both flash on one continuous session for this reason.

  // 3. Compile
  host._step = "queued";
  host._statusMessage = host._localize("firmware.status_queued");
  if (!(await compileOrFail(host, device.configuration))) {
    await releaseSerial(detected);
    return;
  }

  // 4. Download binary
  host._statusMessage = host._localize("firmware.status_downloading");
  let firmwareBytes: Uint8Array;
  let flashAddress: number;
  try {
    const binaries = await host._api.firmwareGetBinaries(device.configuration);
    const target = pickFlashTarget(detected.chipName, binaries);
    if (!target) {
      await releaseSerial(detected);
      host._fail(host._localize("serial.no_firmware"));
      return;
    }
    flashAddress = target.address;
    firmwareBytes = new Uint8Array(
      await host._api.firmwareDownloadBytes(device.configuration, target.binary.file)
    );
  } catch {
    await releaseSerial(detected);
    host._fail(host._localize("firmware.download_failed"));
    return;
  }

  // 5. Flash on the still-open session.
  host._step = "flashing";
  host._statusMessage = host._localize("firmware.status_flashing");
  host._flashPercent = 0;
  try {
    await flashFirmware(detected.loader, firmwareBytes, flashAddress, (p) => {
      host._flashPercent = p.percent;
    });
  } catch (err) {
    console.error("[Web Serial] Flash error:", err);
    // 100% reached: treat as success — device may have reset during verification.
    if (host._flashPercent < 100) {
      await releaseSerial(detected);
      host._fail(formatApiError(err, host._localize, "firmware.flash_failed"));
      return;
    }
  }

  // 6. Reset
  host._statusMessage = host._localize("firmware.status_resetting");
  try {
    await resetAndDisconnect(detected.loader, detected.transport, detected.port);
  } catch {
    // resetAndDisconnect disconnects in its own finally; if that threw through
    // and left the port held, release it so it doesn't leak into a retry.
    await releaseSerial(detected);
  }

  host._statusMessage = host._localize("firmware.status_done");
  host._step = "done";
  // _cancel closes the UI but doesn't interrupt the flash loop — a dismissed
  // install can still reach here, so gate the auto-flip on the dialog still
  // being open. Otherwise the logs viewer pops up on a user who walked away.
  if (host._open && host._showLogsAfterInstall) {
    flipToLogs(host, detected.port);
  }
}

// Best-effort release of the held serial port on an early return, so a failed
// compile / download / flash doesn't leak an open port into the next attempt.
// Falls back to closing the port directly when transport.disconnect throws,
// mirroring connectToPort — a still-open port breaks the next port.open.
async function releaseSerial(detected: DetectedChip): Promise<void> {
  try {
    await disconnect(detected.transport);
  } catch {
    try {
      await detected.port.close();
    } catch {
      /* best-effort */
    }
  }
}

export function flipToLogs(
  host: ESPHomeFirmwareInstallDialog,
  webSerialPort: SerialPort
): void {
  const device = host._device;
  if (!device) return;
  const handled = dispatchShowLogsAfterInstall(host, {
    configuration: device.configuration,
    name: device.friendly_name || device.name,
    webSerialPort,
    // Raw baud; the logs handler resolves it (0 ⇒ disabled, skip with a notice).
    loggerBaudRate: device.logger_baud_rate,
    reopenInstall: () => host.reopen(),
  });
  if (handled) host._open = false;
}

// Web-flash logs go over OTA/native-API: the serial port lived in the external
// flasher tab, so there's nothing local to read.
export function showOtaLogs(host: ESPHomeFirmwareInstallDialog): void {
  const device = host._device;
  if (!device) return;
  const handled = dispatchShowLogsAfterInstall(host, {
    configuration: device.configuration,
    name: device.friendly_name || device.name,
    port: OTA_PORT,
    reopenInstall: () => host.reopen(),
  });
  if (handled) host._open = false;
}

// Compile, surfacing a failure on the dialog. Returns false so the caller bails.
async function compileOrFail(
  host: ESPHomeFirmwareInstallDialog,
  configuration: string
): Promise<boolean> {
  try {
    await compileAndWait(host, configuration);
    return true;
  } catch (err) {
    host._failedDuringCompile = true;
    host._fail(host._localize("firmware.compile_failed"), compileFailureDetail(err));
    return false;
  }
}

// List build artefacts, surfacing a failure on the dialog. Returns null so the
// caller bails.
async function fetchBinaries(
  host: ESPHomeFirmwareInstallDialog,
  configuration: string
): Promise<FirmwareBinary[] | null> {
  try {
    return await host._api.firmwareGetBinaries(configuration);
  } catch {
    host._fail(host._localize("firmware.download_failed"));
    return null;
  }
}

function showBinaryPicker(
  host: ESPHomeFirmwareInstallDialog,
  binaries: FirmwareBinary[]
): void {
  host._binaries = binaries;
  host._statusMessage = "";
  host._step = "choose-binary";
}

// Reached after a *successful* compile when there's nothing to flash. A remote
// build that returned an EMPTY list is a packaging / transfer problem on the
// build server, so name it. Binaries that came back but aren't web-flashable
// (e.g. only OTA / uf2) transferred fine — that's a web.esphome.io format
// limit, so they keep the flashable-binary message regardless of build origin.
function failNoBinaries(
  host: ESPHomeFirmwareInstallDialog,
  { isWebFlasher, isEmpty }: { isWebFlasher: boolean; isEmpty: boolean }
): void {
  if (isEmpty && host._jobSource === JobSource.REMOTE) {
    const receiver =
      host._jobSourceLabel || host._localize("firmware.no_binaries_remote_server");
    host._fail(
      host._localize("firmware.no_binaries_remote", { receiver }),
      host._localize("firmware.no_binaries_remote_detail")
    );
    return;
  }
  host._fail(
    host._localize(isWebFlasher ? "firmware.no_flashable_binary" : "firmware.no_binaries")
  );
}

// The manual binary download: compile, then hand over whatever the build
// produced (incl. .uf2). More than one format routes to the choose-binary
// picker so every image stays reachable.
export async function startDownload(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const device = host._device;
  if (!device) return;

  if (!(await compileOrFail(host, device.configuration))) return;
  host._statusMessage = host._localize("firmware.status_downloading");
  const binaries = await fetchBinaries(host, device.configuration);
  if (!binaries) return;

  if (binaries.length > 1) {
    showBinaryPicker(host, binaries);
    return;
  }
  if (binaries.length === 0) {
    failNoBinaries(host, { isWebFlasher: false, isEmpty: true });
    return;
  }
  await downloadSelectedBinary(host, binaries[0].file);
}

// Three-dot "Download". Compiles only when nothing is built, so an existing
// build's ELF still matches the firmware flashed on the device.
export async function startArtifactDownload(
  host: ESPHomeFirmwareInstallDialog
): Promise<void> {
  const device = host._device;
  if (!device) return;

  if (!(await artifactsSettled(host, device.configuration))) return;

  let binaries = await fetchBinaries(host, device.configuration);
  if (!binaries) return;
  if (binaries.length === 0) {
    if (!(await compileOrFail(host, device.configuration))) return;
    host._statusMessage = host._localize("firmware.status_downloading");
    binaries = await fetchBinaries(host, device.configuration);
    if (!binaries) return;
  }

  if (binaries.length === 0) {
    failNoBinaries(host, { isWebFlasher: false, isEmpty: true });
    return;
  }
  if (binaries.length === 1) {
    await downloadSelectedBinary(host, binaries[0].file);
    return;
  }
  showBinaryPicker(host, binaries);
}

// Fetch one binary and hand it to the browser. Shared by the auto-select
// paths and the picker; leaves _binaries intact for "download another format".
// Re-settles at select time: the picker (or download-ready's "another
// format") can sit open while a new build starts rewriting the file.
export async function downloadSelectedBinary(
  host: ESPHomeFirmwareInstallDialog,
  file: string
): Promise<void> {
  const device = host._device;
  if (!device) return;
  if (!(await artifactsSettled(host, device.configuration))) return;
  host._statusMessage = host._localize("firmware.status_downloading");
  // Distinct from the compile steps: the byte fetch isn't cancelable, so the
  // footer must not offer Stop (see renderFooter).
  host._step = "downloading";
  try {
    const { url, filename } = await host._api.firmwareDownloadUrl(
      device.configuration,
      file
    );
    triggerDownload(url, filename);
    host._downloadedFilename = filename;
  } catch {
    host._fail(host._localize("firmware.download_failed"));
    return;
  }
  host._step = "download-ready";
  host._statusMessage = "";
}

/**
 * The self-contained image flashed from scratch at 0x0. ESP8266 / ESP8285 is
 * the single ``firmware.bin``; ESP32 is the merged ``*.factory.bin`` (its plain
 * ``firmware.bin`` is the app-only image at 0x10000, not flashable from 0x0).
 * Returns undefined when no from-scratch image was produced.
 *
 * Distinct from ``pickFlashTarget`` on purpose: web-flash only has the coarse
 * ``target_platform`` (no chip yet), so it matches strictly and has no
 * ``binaries[0]`` fallback. Don't unify the two.
 */
export function pickFactoryBinary(
  targetPlatform: string,
  binaries: FirmwareBinary[]
): FirmwareBinary | undefined {
  if (targetPlatform.toLowerCase().startsWith("esp82")) {
    return binaries.find((b) => b.file === "firmware.bin");
  }
  return (
    binaries.find((b) => b.file === "firmware.factory.bin") ??
    binaries.find((b) => b.file.endsWith(".factory.bin"))
  );
}

// "Flash via USB" through the external flasher: compile + download the factory
// image HERE (logs/errors visible, like the download flow), then land on the
// download-ready step. The flasher tab is opened only afterwards, on the user's
// click, so we never hand off until a working firmware exists.
export async function startUsbFlash(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const device = host._device;
  if (!device) return;
  if (!(await compileOrFail(host, device.configuration))) return;
  host._statusMessage = host._localize("firmware.status_downloading");
  host._step = "downloading";
  const binaries = await fetchBinaries(host, device.configuration);
  if (!binaries) return;
  const factory = pickFactoryBinary(device.target_platform, binaries);
  if (!factory) {
    failNoBinaries(host, { isWebFlasher: true, isEmpty: binaries.length === 0 });
    return;
  }
  try {
    host._usbFirmware = await host._api.firmwareDownloadBytes(
      device.configuration,
      factory.file
    );
    host._usbFirmwareName = factory.file;
  } catch {
    host._fail(host._localize("firmware.download_failed"));
    return;
  }
  host._step = "download-ready";
  host._statusMessage = "";
}

// Open the external flasher and hand off the already-built firmware, mirroring
// its progress/result into the dialog. Called from the download-ready "Open USB
// flasher" button (a user gesture, so the pop-up isn't blocked).
export function handOffToFlasher(host: ESPHomeFirmwareInstallDialog): void {
  const firmware = host._usbFirmware;
  if (!firmware) return;
  host._step = "flashing";
  host._flashPercent = 0;
  host._statusMessage = host._localize("firmware.usb_flashing");
  host._errorMessage = "";
  const deviceName = host._device ? host._device.friendly_name || host._device.name : "";
  // An in-tab retry after a failure resumes via progress/status frames; leave
  // the error view and clear the failure banner so it doesn't headline a flash
  // that's already running (a progress frame often lands before a status one).
  const resumeFromError = () => {
    if (host._step !== "error") return;
    host._step = "flashing";
    host._errorMessage = "";
    host._statusMessage = host._localize("firmware.usb_flashing");
  };
  const teardown = openFlasher(firmware, host._usbFirmwareName, deviceName, {
    onProgress: (pct) => {
      resumeFromError();
      host._flashPercent = pct;
    },
    onStatus: (detail) => {
      resumeFromError();
      host._statusMessage = detail;
    },
    onState: (state, detail) => {
      if (state === "done") {
        host._usbFlashTeardown = null;
        host._step = "done";
        host._statusMessage = host._localize("firmware.usb_done");
      } else {
        // Non-terminal: the flasher tab can retry in place, so keep the
        // teardown live for a later success or close.
        host._fail(host._localize("firmware.usb_failed"), detail);
      }
    },
    onLost: () => {
      host._usbFlashTeardown = null;
      host._fail(
        host._localize("firmware.usb_failed"),
        host._localize("firmware.usb_window_closed")
      );
    },
  });
  if (!teardown) {
    // Pop-up blocked: stay on download-ready with the firmware still in hand so
    // the user can allow pop-ups and click Open again, rather than being forced
    // through a full recompile. The message surfaces in the ready-screen detail.
    host._step = "download-ready";
    host._statusMessage = "";
    host._errorMessage = host._localize("firmware.usb_popup_blocked");
    return;
  }
  // The openFlasher session now holds the bytes (in its closure) and transfers
  // them to the tab on the ready hand-off; drop the dialog's reference. A retry
  // after a lost/never-ready tab recompiles, which is incremental and cheap.
  host._usbFirmware = null;
  host._usbFlashTeardown = teardown;
}

/**
 * Wait out any running job for *configuration* before touching its
 * artifacts — a running build both rewrites the files a download would
 * read and would be superseded (cancelled + restarted) by a fresh
 * compile (#1200).
 *
 * True to proceed; false when the wait didn't complete (dialog dismissed,
 * or the follow stream errored and the dialog already shows the failure).
 */
async function artifactsSettled(
  host: ESPHomeFirmwareInstallDialog,
  configuration: string
): Promise<boolean> {
  const running = host._activeJobs.get(configuration);
  if (!running) return true;
  host._statusMessage = host._localize("firmware.status_waiting_build");
  if (!(await waitForRunningJob(host, running.job_id))) return false;
  host._statusMessage = host._localize("firmware.status_downloading");
  return true;
}

/**
 * Stream an already-running job into the dialog and wait for it to reach
 * a terminal state.
 *
 * Deliberately never sets ``host._jobId``: the dialog doesn't own this
 * job, so dismissing the dialog must not cancel it — teardown only
 * stops the follow stream. Resolves true on ANY terminal outcome (a
 * failed or cancelled build just means the caller compiles fresh
 * afterwards); false when the dialog was dismissed mid-wait, or on a
 * follow-stream error — a dead stream says nothing about the job, so
 * proceeding could still read torn artifacts or supersede it. The error
 * case fails the dialog with *failKey*; a retry re-reads the active-jobs
 * map.
 */
export function waitForRunningJob(
  host: ESPHomeFirmwareInstallDialog,
  jobId: string,
  failKey = "firmware.download_failed"
): Promise<boolean> {
  return new Promise((resolve) => {
    host._compileReject = () => resolve(false);
    host._streamId = host._api.firmwareFollowJob(jobId, {
      onOutput: (line) => {
        if (host._step === "queued") host._step = "compiling";
        host._timer.noteLine(line);
        host._logLines = [...host._logLines, line];
      },
      onResult: () => {
        host._streamId = "";
        host._compileReject = null;
        resolve(true);
      },
      onError: () => {
        host._streamId = "";
        host._compileReject = null;
        host._fail(host._localize(failKey));
        resolve(false);
      },
    });
  });
}

export function compileAndWait(
  host: ESPHomeFirmwareInstallDialog,
  configuration: string
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    // Capture reject on the dialog so a mid-flight detach (header-X / Escape /
    // reopen) can settle this promise. followJob callbacks clear the hook to
    // null on fire so a normal completion doesn't double-reject on teardown.
    host._compileReject = reject;
    try {
      const job = await host._api.firmwareCompile(configuration);
      host._jobId = job.job_id;
      // Capture so a compile failure can pick the right hint variant:
      // local jobs get the link-to-reset, remote jobs get the plain-text
      // "ask the operator of <receiver>" instruction.
      host._jobSource = job.source;
      host._jobSourceLabel = job.source_label;
      host._streamId = host._api.firmwareFollowJob(job.job_id, {
        onOutput: (line) => {
          if (host._step === "queued") {
            host._step = "compiling";
            host._statusMessage = host._localize("firmware.status_compiling");
          }
          host._timer.noteLine(line);
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
