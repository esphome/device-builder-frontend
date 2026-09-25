/**
 * Formatting shared by the browser flash engines' details-log lines, so the
 * esptool, RTL8720C, nRF52 and Pico flows read alike.
 */

/** ``0x``-prefixed upper-case flash address. */
export const formatAddress = (address: number): string =>
  `0x${address.toString(16).toUpperCase()}`;

/** ``vvvv:pppp`` USB ids, as port labels and device lines print them. */
export function formatUsbId(vendorId: number, productId: number): string {
  const hex = (n: number) => n.toString(16).padStart(4, "0");
  return `${hex(vendorId)}:${hex(productId)}`;
}

/**
 * A progress line every ten percent: feed it each percent as it lands and it
 * logs ``<label>: <percent>%`` the first time a new tenth is reached (the
 * percent as reached, so a transfer that jumps to 68% prints 68%).
 */
export function tenthLogger(
  log: (line: string) => void,
  label: string
): (percent: number) => void {
  let nextTenth = 10;
  return (percent) => {
    if (percent < nextTenth) return;
    log(`${label}: ${percent}%`);
    nextTenth = Math.floor(percent / 10) * 10 + 10;
  };
}
