import { parseBoardGpio } from "./pin/gpio.js";
import { parsePlainDecimal } from "./yaml-scalar.js";

/** A form value as the YAML scan reads it; the type carries the spelling. */
export type OptionRawValue = string | number | boolean | null | undefined;

/** ``pins`` also accepts a board GPIO alias (``9`` / ``P0.9`` for ``GPIO9``); only
 *  a pin select wants that, an ordinary enum spelled ``"1"`` must not take ``GPIO1``. */
export interface OptionMatchOptions {
  pins?: boolean;
}

/**
 * Whether the option spelled *option* presents *raw*: the same text, a case
 * fold (``esp32c6`` / ``ESP32C6``), or, for a number only, the same plain
 * decimal: a bare YAML ``3.0`` reads as 3 while the catalog spells the
 * option ``"3.0"``. A quoted ``"3"`` arrives as a string and keeps its own
 * spelling. A non-primitive never matches.
 */
export function optionShowsValue(
  option: string,
  raw: unknown,
  { pins = false }: OptionMatchOptions = {}
): boolean {
  if (!isOptionRawValue(raw) || raw == null) return false;
  const text = String(raw);
  if (option === text) return true;
  if (!option || !text) return false;
  if (option.toLowerCase() === text.toLowerCase()) return true;
  if (typeof raw === "number" && parsePlainDecimal(option) === raw) return true;
  if (!pins) return false;
  const gpio = parseBoardGpio(raw);
  return gpio !== null && parseBoardGpio(option) === gpio;
}

/** The option spelling *raw* lands on, or null when no option presents it. */
export function findOptionValue(
  raw: unknown,
  options: readonly string[],
  { pins = false }: OptionMatchOptions = {}
): string | null {
  if (!isOptionRawValue(raw) || raw == null) return null;
  const text = String(raw);
  if (!text) return null;
  const lower = text.toLowerCase();
  const folded = options.find((o) => o.toLowerCase() === lower);
  if (folded !== undefined) return folded;
  if (typeof raw === "number") {
    const decimal = options.find((o) => parsePlainDecimal(o) === raw);
    if (decimal !== undefined) return decimal;
  }
  if (!pins) return null;
  const gpio = parseBoardGpio(raw);
  if (gpio === null) return null;
  return options.find((o) => parseBoardGpio(o) === gpio) ?? null;
}

function isOptionRawValue(raw: unknown): raw is OptionRawValue {
  return (
    raw == null ||
    typeof raw === "string" ||
    typeof raw === "number" ||
    typeof raw === "boolean"
  );
}
