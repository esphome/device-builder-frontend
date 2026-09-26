/**
 * The install dialogs' side of the install → logs hand-off: the event they
 * fire and its detail. A leaf on purpose (it only needs ``fire-event``), so
 * the install flows can hand off without importing the logs code, which
 * reads the platform registry that imports those flows.
 */
import { fireRequestEvent } from "./fire-event.js";

/**
 * Detail shape of the cancelable ``request-show-logs-after-install``
 * event dispatched by the install dialogs (command-dialog for OTA /
 * server-serial, firmware-install-dialog for Web Serial).
 *
 * ``port`` is set on the network / server-serial path. ``webSerialPort``
 * is set on the Web Serial path — the dispatching dialog disconnected
 * it for the install reset, and the handler reopens it at log baud.
 * Exactly one of those two is set per event. ``reopenInstall`` is the
 * callback the logs dialog's "Back to install" button invokes to
 * re-show the original install dialog with its preserved state.
 */
export interface PostInstallShowLogsDetail {
  configuration: string;
  name: string;
  port?: string;
  webSerialPort?: SerialPort;
  // Raw device logger baud_rate, only meaningful on the webSerialPort path.
  // The handler resolves it: null / absent ⇒ 115200 default, 0 ⇒ serial
  // logging disabled (skip with a notice).
  loggerBaudRate?: number | null;
  // Resolved logger output interface (Device.logger_interface), only
  // meaningful on the webSerialPort path: a port that can't carry it
  // reroutes to network logs.
  loggerInterface?: string | null;
  // Device.target_platform, so the logs get the same Reset Device wiring as
  // a launch from the card (the platform's own reset where it has one).
  targetPlatform?: string;
  reopenInstall: () => void;
}

/**
 * Dispatch the cancelable ``request-show-logs-after-install`` event
 * from an install dialog. Returns ``true`` iff a host claimed the
 * handoff (called ``preventDefault()``) — the install dialog uses
 * that to decide whether to hide itself or stay open. Centralised
 * here so the two install dialogs (command-dialog for OTA / server-
 * serial, firmware-install-dialog for Web Serial) don't drift on
 * the event name, the ``cancelable`` flag, or the bubble shape.
 */
export function dispatchShowLogsAfterInstall(
  source: HTMLElement,
  detail: PostInstallShowLogsDetail
): boolean {
  return fireRequestEvent(source, "request-show-logs-after-install", detail);
}
