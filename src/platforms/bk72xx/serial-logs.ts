import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { HandoffLogs } from "../handoff.js";
import type { SerialLogsPolicy } from "../serial-logs.js";

/**
 * Chromium asserts DTR and RTS on open. On an adapter whose RTS reaches
 * CEN that holds the chip in reset, so both are released. RTS still resets
 * it on demand; on an adapter wired to TX, RX and GND alone the pulse does
 * nothing.
 */
export const BK72XX_SERIAL_LOGS: SerialLogsPolicy = {
  reset: "rts-pulse",
  releaseLinesAfterOpen: true,
};

/** The config that puts the logs on the port the install flashes over. */
export const BK_LOGS_ON_FLASH_PORT_SETTING = "logger: hardware_uart: UART1";

/**
 * Whether the device logs on UART1, the port the install flashes over. The
 * BK72xx default is UART2, which the backend reports as no interface.
 */
export const bkLogsOnFlashPort = (
  device: Pick<ConfiguredDevice, "logger_interface" | "logger_baud_rate"> | null
): boolean => device?.logger_interface === "UART1" && device.logger_baud_rate !== 0;

/** Where the device's serial logs are, for a receiver that installs it. */
export const bkHandoffLogs = (
  device: Pick<ConfiguredDevice, "logger_interface" | "logger_baud_rate"> | null
): HandoffLogs | undefined =>
  device?.logger_baud_rate === 0
    ? "off"
    : bkLogsOnFlashPort(device)
      ? "flash-port"
      : undefined;
