// The device pickers (Web Serial, WebUSB, Web Bluetooth) and the click they need.

/**
 * The browser refused a device picker because the click that asked for it
 * no longer counts: a picker needs the click's user activation, which lasts
 * a few seconds, and something awaited before the picker outlasted it.
 */
export class PickerActivationError extends Error {
  constructor(
    // Error.cause needs lib ES2022; the field is declared here instead.
    readonly cause: unknown
  ) {
    super("The device picker was refused: the click's user activation ran out");
    this.name = "PickerActivationError";
  }
}

/**
 * A picker's rejection, named when it is the lapsed activation. The browser
 * throws ``SecurityError`` for that and for a blocked feature alike, so it
 * only counts with the activation gone; where the browser does not report
 * the activation, the error stays as it is.
 */
export function pickerFailure(err: unknown): unknown {
  const lapsed =
    err instanceof DOMException &&
    err.name === "SecurityError" &&
    navigator.userActivation?.isActive === false;
  return lapsed ? new PickerActivationError(err) : err;
}
