/**
 * The Device Builder's ESP install over Web Serial: detect the chip, check it
 * against the device's board, compile, then flash the image esptool-js needs
 * at the right offset.
 */
import type { FirmwareBinary } from "../../api/types/firmware-jobs.js";
import type { ESPHomeFirmwareInstallDialog } from "../../components/firmware-install-dialog.js";
import {
  compileOrFail,
  finishWithLogsPort,
} from "../../components/firmware-install-dialog/install-flow.js";
import { fetchBoard } from "../../util/board-body-cache.js";
import { chipNameToVariant, chipPlatformFamily } from "../../util/chip-variant.js";
import { getErrorMessage } from "../../util/error-message.js";
import { formatApiError } from "../../util/format-api-error.js";
import { openFailureMessage } from "../../util/serial-open-error.js";
import {
  type DetectedChip,
  EngineLoadError,
  type Esptool,
  pickPortAndLoadEsptool,
  UnsupportedChipError,
} from "./index.js";

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
    host._log.enqueue(line);
  };

  // 1. Pick the port in the click (the engine chunk fetches meanwhile), then
  // connect and detect the chip. A dismissed picker closes the dialog.
  let picked: Awaited<ReturnType<typeof pickPortAndLoadEsptool>>;
  try {
    picked = await pickPortAndLoadEsptool();
  } catch (err) {
    host._fail(
      err instanceof EngineLoadError
        ? host._localize("firmware.engine_load_failed")
        : openFailureMessage(err, host._localize, "serial.connect_failed"),
      getErrorMessage(err)
    );
    return;
  }
  if (!picked) {
    host._close();
    return;
  }
  const { port, esptool } = picked;
  let detected: DetectedChip;
  try {
    detected = await esptool.connectToPort(port, onLog);
  } catch (err) {
    if (err instanceof UnsupportedChipError) {
      host._fail(host._localize("serial.unsupported_chip", { chip: err.chipName }));
      return;
    }
    // The picker succeeded but the chip never answered — fail loud with
    // the esptool log expanded instead of silently closing (#1414).
    host._fail(
      openFailureMessage(err, host._localize, "serial.connect_failed"),
      getErrorMessage(err)
    );
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
    await releaseSerial(esptool, detected);
    host._failureKind = "chip-mismatch";
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
    await releaseSerial(esptool, detected);
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
      await releaseSerial(esptool, detected);
      host._fail(host._localize("serial.no_firmware"));
      return;
    }
    flashAddress = target.address;
    firmwareBytes = new Uint8Array(
      await host._api.firmwareDownloadBytes(device.configuration, target.binary.file)
    );
  } catch {
    await releaseSerial(esptool, detected);
    host._fail(host._localize("firmware.download_failed"));
    return;
  }

  // 5. Flash on the still-open session.
  host._step = "flashing";
  host._statusMessage = host._localize("firmware.status_flashing");
  host._flashPercent = 0;
  try {
    await esptool.flashFirmware(detected.loader, firmwareBytes, flashAddress, (p) => {
      host._flashPercent = p.percent;
    });
  } catch (err) {
    console.error("[Web Serial] Flash error:", err);
    // 100% reached: treat as success — device may have reset during verification.
    if (host._flashPercent < 100) {
      await releaseSerial(esptool, detected);
      host._fail(formatApiError(err, host._localize, "firmware.flash_failed"));
      return;
    }
  }

  // 6. Reset
  host._statusMessage = host._localize("firmware.status_resetting");
  try {
    await esptool.resetAndDisconnect(detected.loader, detected.transport, detected.port);
  } catch {
    // resetAndDisconnect disconnects in its own finally; if that threw through
    // and left the port held, release it so it doesn't leak into a retry.
    await releaseSerial(esptool, detected);
  }

  host._statusMessage = host._localize("firmware.status_done");
  finishWithLogsPort(host, detected.port);
}

// Best-effort release of the held serial port on an early return, so a failed
// compile / download / flash doesn't leak an open port into the next attempt.
// Falls back to closing the port directly when transport.disconnect throws,
// mirroring connectToPort — a still-open port breaks the next port.open.
async function releaseSerial(esptool: Esptool, detected: DetectedChip): Promise<void> {
  try {
    await esptool.disconnect(detected.transport);
  } catch {
    try {
      await detected.port.close();
    } catch {
      /* best-effort */
    }
  }
}
