import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { SerialLogsPolicy } from "../serial-logs.js";

/**
 * Chromium asserts DTR and RTS on open. On a board whose RTS reaches CEN
 * that holds the chip in reset, and DTR on BOOT would send its next reset
 * to the ROM downloader, so both are released. RTS still resets it on
 * demand; on an adapter wired to TX, RX and GND alone the pulse does nothing.
 */
export const LN882X_SERIAL_LOGS: SerialLogsPolicy = {
  reset: "rts-pulse",
  releaseLinesAfterOpen: true,
};

/** The config that puts the logs on the port the install flashes over. */
export const LN_LOGS_ON_FLASH_PORT_SETTING = "logger: hardware_uart: UART0";

/**
 * Whether the device logs on UART0, the port the install flashes over.
 * LibreTiny logs on UART1 (PB9) by default on a chip that has it, which the
 * backend reports as no interface.
 */
export const lnLogsOnFlashPort = (
  device: Pick<ConfiguredDevice, "logger_interface" | "logger_baud_rate"> | null
): boolean => device?.logger_interface === "UART0" && device.logger_baud_rate !== 0;
