/**
 * ESPHome GPIO pin `mode:` accepts both a flag object
 * (`{output: true, pullup: true}`) and a scalar shorthand string
 * (`OUTPUT`, `INPUT_PULLUP`, …). The shorthands are fixed,
 * platform-independent presets of the same five flags, so they expand
 * losslessly onto the catalog's flag checkboxes. Mirrors `PIN_MODES`
 * in ESPHome's `esphome/pins.py` `_set_mode`.
 */

/** Scalar mode shorthands → their flag dict. Keys are upper-cased. */
export const PIN_MODE_SHORTHANDS: Readonly<
  Record<string, Readonly<Record<string, boolean>>>
> = {
  INPUT: { input: true },
  OUTPUT: { output: true },
  INPUT_PULLUP: { input: true, pullup: true },
  OUTPUT_OPEN_DRAIN: { output: true, open_drain: true },
  INPUT_PULLDOWN_16: { input: true, pulldown: true },
  INPUT_PULLDOWN: { input: true, pulldown: true },
  INPUT_OUTPUT_OPEN_DRAIN: { input: true, output: true, open_drain: true },
};

/** Expand a scalar pin-mode shorthand to its flag dict; null if unknown.
 *  Case-insensitive (ESPHome matches on `mode.upper()`). */
export function expandPinModeShorthand(value: string): Record<string, boolean> | null {
  const flags = PIN_MODE_SHORTHANDS[value.toUpperCase()];
  return flags ? { ...flags } : null;
}
