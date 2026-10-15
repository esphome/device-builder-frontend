/**
 * The bootloader answered a DFU request with an error. Kept out of the
 * engine's chunk so the install flow can tell it from a bootloader that
 * never answered: the way out of this one is not the RESET button.
 */
export class DfuResponseError extends Error {
  constructor(
    /** The request the bootloader refused, by name. */
    readonly operation: string,
    message: string
  ) {
    super(`${operation}: ${message}`);
    this.name = "DfuResponseError";
  }
}
