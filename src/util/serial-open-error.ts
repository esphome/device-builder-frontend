import type { LocalizeFunc } from "../common/localize.js";
import { getErrorMessage } from "./error-message.js";
import { PickerActivationError } from "./picker-activation.js";

// The copy for a failed serial open or connect, and the errors it names.
//
// Rejections that came from ``SerialPort.open()`` itself. A read or write
// on a device that dropped mid-session throws ``NetworkError`` too, and that
// one must not read as another program holding the port.
const openFailures = new WeakSet<object>();

/** Remember ``err`` as the rejection of a ``SerialPort.open()`` call. */
export function markOpenFailure(err: unknown): void {
  if (typeof err === "object" && err !== null) openFailures.add(err);
}

/** ``port.open(options)``, marking a rejection as an open failure. */
export async function openSerialPort(
  port: SerialPort,
  options: SerialOptions
): Promise<void> {
  try {
    await port.open(options);
  } catch (err) {
    markOpenFailure(err);
    throw err;
  }
}

/**
 * Whether a failed open most likely means something else holds the port.
 * Chrome throws ``NetworkError`` for every failed open, and on a manual open
 * that is almost always another tab, window or program; it can also be a
 * permissions or driver problem, so the copy hedges and carries the error. A
 * board still re-enumerating after a reset throws the same, so only use this
 * on a manual open where nothing just restarted.
 */
function isPortInUse(err: unknown): boolean {
  return (
    err instanceof DOMException && err.name === "NetworkError" && openFailures.has(err)
  );
}

/** The "may be open elsewhere" copy for a failed manual open, or undefined. */
export function portInUseMessage(
  err: unknown,
  localize: LocalizeFunc
): string | undefined {
  return isPortInUse(err)
    ? localize("serial.port_in_use", { error: getErrorMessage(err) })
    : undefined;
}

/** A device never answered the connect handshake before the deadline. */
export class SerialConnectTimeoutError extends Error {
  readonly seconds: number;

  constructor(deadlineMs: number) {
    const seconds = Math.round(deadlineMs / 1000);
    super(`No answer from the device in ${seconds} s`);
    this.name = "SerialConnectTimeoutError";
    this.seconds = seconds;
  }
}

/** ``SerialPort.open()`` had not returned by a deadline; the port is still opening. */
export class SerialOpenTimeoutError extends Error {
  readonly seconds: number;

  constructor(deadlineMs: number) {
    const seconds = Math.round(deadlineMs / 1000);
    super(`The serial port did not open in ${seconds} s`);
    this.name = "SerialOpenTimeoutError";
    this.seconds = seconds;
  }
}

/** The device went away (unplugged, or it dropped off the bus) while it was in use. */
export class SerialDeviceLostError extends Error {
  constructor(
    // Error.cause needs lib ES2022; the field is declared here instead.
    readonly cause?: unknown
  ) {
    super("The device disconnected during the operation");
    this.name = "SerialDeviceLostError";
  }
}

/**
 * ``err`` as a lost device when it is one: the browser fails a read or a
 * write on a device that went away with ``NetworkError``, as it does a
 * failed open, which is not a lost device. Undefined for anything else.
 */
export function deviceLostFrom(err: unknown): SerialDeviceLostError | undefined {
  if (err instanceof SerialDeviceLostError) return err;
  const lost =
    err instanceof DOMException && err.name === "NetworkError" && !openFailures.has(err);
  return lost ? new SerialDeviceLostError(err) : undefined;
}

/** A write did not return by its deadline; the device is there but not taking data. */
export class SerialWriteStalledError extends Error {
  readonly seconds: number;

  constructor(deadlineMs: number) {
    const seconds = Math.round(deadlineMs / 1000);
    super(`The device took no data in ${seconds} s`);
    this.name = "SerialWriteStalledError";
    this.seconds = seconds;
  }
}

/** The port could not be closed or released; it stays held until the board is replugged. */
export class SerialPortHeldError extends Error {
  constructor() {
    super("The serial port could not be released; unplug and replug the board");
    this.name = "SerialPortHeldError";
  }
}

/**
 * The copy for a failed pick, connect or write that can be named: a picker refused
 * for a click that ran out, the port held elsewhere, the device never
 * answering, the port never opening, the port not releasing, or the device
 * lost or gone quiet during a write; undefined for anything else.
 */
export function namedConnectFailure(
  err: unknown,
  localize: LocalizeFunc
): string | undefined {
  if (err instanceof PickerActivationError) return localize("serial.picker_needs_click");
  if (err instanceof SerialConnectTimeoutError) {
    return localize("serial.connect_timed_out", { seconds: err.seconds });
  }
  if (err instanceof SerialOpenTimeoutError) {
    return localize("serial.open_timed_out", { seconds: err.seconds });
  }
  if (err instanceof SerialPortHeldError) return localize("serial.port_held");
  if (err instanceof SerialDeviceLostError) return localize("serial.device_lost");
  if (err instanceof SerialWriteStalledError) {
    return localize("serial.write_stalled", { seconds: err.seconds });
  }
  return portInUseMessage(err, localize);
}

/** The copy for a failed manual open or connect: a named failure when it is one, else ``fallbackKey`` with the error. */
export function openFailureMessage(
  err: unknown,
  localize: LocalizeFunc,
  fallbackKey = "serial.open_failed"
): string {
  return (
    namedConnectFailure(err, localize) ??
    localize(fallbackKey, { error: getErrorMessage(err) })
  );
}

/** The detail under a failure's title: its name when it has one, else what ``fallback`` makes of the error. */
export function connectFailureDetail(
  err: unknown,
  localize: LocalizeFunc,
  fallback: (err: unknown) => string = getErrorMessage
): string {
  return namedConnectFailure(err, localize) ?? fallback(err);
}
