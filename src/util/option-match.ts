import { parseBoardGpio } from "./pin/gpio.js";
import { parsePlainDecimal } from "./yaml-scalar.js";

/**
 * Whether the option spelled *option* presents *raw*: the same text, a case
 * fold (``esp32c6`` / ``ESP32C6``), the same plain decimal (a bare YAML
 * ``3.0`` reads as 3 while the catalog spells the option ``"3.0"``), or the
 * same board GPIO (``9`` / ``GPIO9``).
 */
export function optionShowsValue(option: string, raw: string): boolean {
  if (option === raw) return true;
  if (!option || !raw) return false;
  if (option.toLowerCase() === raw.toLowerCase()) return true;
  const n = parsePlainDecimal(raw);
  if (n !== null && parsePlainDecimal(option) === n) return true;
  const gpio = parseBoardGpio(raw);
  return gpio !== null && parseBoardGpio(option) === gpio;
}

/** The option spelling *raw* lands on, or null when no option presents it. */
export function findOptionValue(raw: string, options: readonly string[]): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const folded = options.find((o) => o.toLowerCase() === lower);
  if (folded !== undefined) return folded;
  const n = parsePlainDecimal(raw);
  if (n !== null) {
    const decimal = options.find((o) => parsePlainDecimal(o) === n);
    if (decimal !== undefined) return decimal;
  }
  const gpio = parseBoardGpio(raw);
  if (gpio === null) return null;
  return options.find((o) => parseBoardGpio(o) === gpio) ?? null;
}
