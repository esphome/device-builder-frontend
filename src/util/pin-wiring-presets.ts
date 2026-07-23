/**
 * Wiring presets for native GPIO pin fields: each preset names a
 * plain-language circuit (button to ground, active-low relay, …) and
 * expands to the long-form pin flags, so the visual editor can ask
 * "how is it wired?" instead of leading with raw mode flags.
 */

import type { BoardPin } from "../api/types/boards.js";
import { PinFeature, PinMode } from "../api/types/config-entries.js";
import { isPlainObject } from "./nested-values.js";
import { expandPinModeShorthand, PIN_MODE_SHORTHANDS } from "./pin-mode.js";
import { parseYamlBoolean } from "./yaml-serialize.js";

/** Mode-flag keys the guided wiring editor understands — the five native
 *  flags, derived from the shorthand table so the two can't drift. A
 *  value carrying any other flag (``analog``, an expander-specific flag)
 *  falls back to the raw flag list. */
export const KNOWN_MODE_FLAGS: ReadonlySet<string> = new Set(
  Object.values(PIN_MODE_SHORTHANDS).flatMap((flags) => Object.keys(flags))
);

export interface WiringPreset {
  /** Localization suffix: ``device.pin_wiring_<id>`` / ``…_description``. */
  id: string;
  /** Exact flag set the preset writes (and matches against). */
  flags: Readonly<Record<string, boolean>>;
  /** ``inverted`` requirement for matching; ``null`` matches either. */
  invertedMatch: boolean | null;
  /** ``inverted`` a pick writes; ``null`` leaves the current value. */
  invertedWrite: boolean | null;
  recommended?: boolean;
}

const INPUT_PRESETS: WiringPreset[] = [
  {
    id: "ground_switch",
    flags: { input: true, pullup: true },
    invertedMatch: null,
    invertedWrite: true,
    recommended: true,
  },
  {
    id: "vcc_switch",
    flags: { input: true, pulldown: true },
    invertedMatch: null,
    invertedWrite: false,
  },
  {
    id: "driven_signal",
    flags: { input: true },
    invertedMatch: null,
    invertedWrite: null,
  },
];

const OUTPUT_PRESETS: WiringPreset[] = [
  {
    id: "output_standard",
    flags: { output: true },
    invertedMatch: false,
    invertedWrite: false,
    recommended: true,
  },
  {
    id: "output_active_low",
    flags: { output: true },
    invertedMatch: true,
    invertedWrite: true,
  },
  {
    id: "output_open_drain",
    flags: { output: true, open_drain: true },
    invertedMatch: null,
    invertedWrite: null,
  },
];

/** Presets for a pin field's declared direction; empty when the field has
 *  no single direction (``input_output``, or an untyped pin), which keeps
 *  the raw-flag disclosure for those fields. */
export function presetsForPinMode(pinMode: PinMode | null | undefined): WiringPreset[] {
  if (pinMode === PinMode.INPUT) return INPUT_PRESETS;
  if (pinMode === PinMode.OUTPUT) return OUTPUT_PRESETS;
  return [];
}

export type WiringState =
  | { kind: "default" }
  | {
      kind: "preset";
      preset: WiringPreset;
      /** No flags stored — the preset is the platform's implied default
       *  direction, not an explicit user choice. */
      implicit?: boolean;
    }
  | { kind: "custom" };

/** The set flags of a ``mode`` value (object form, or a known scalar
 *  shorthand); ``null`` when the value can't be read as flags — including
 *  a flag holding a ``${var}`` reference, which must fall through to the
 *  raw editor rather than be silently dropped and overwritten. */
export function modeFlagsOf(modeValue: unknown): Record<string, boolean> | null {
  if (modeValue === undefined || modeValue === null) return {};
  if (typeof modeValue === "string") return expandPinModeShorthand(modeValue);
  if (!isPlainObject(modeValue)) return null;
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(modeValue)) {
    const parsed = parseYamlBoolean(value);
    if (parsed === null && value !== undefined && value !== null) return null;
    if (parsed === true) out[key] = true;
  }
  return out;
}

/**
 * Classify the current ``mode``/``inverted`` pair against *presets*.

 * An exact flag-set match (with the closest ``invertedMatch``) → that
 * preset; no flags at all → the preset matching *pinMode*'s implied
 * default direction, marked ``implicit`` (ESPHome runs the untouched pin
 * that way); anything else → custom.
 */
export function wiringStateOf(
  presets: WiringPreset[],
  modeValue: unknown,
  invertedValue: unknown,
  pinMode?: PinMode | null
): WiringState {
  const flags = modeFlagsOf(modeValue);
  if (flags === null) return { kind: "custom" };
  const invertedSet = invertedValue !== undefined && invertedValue !== null;
  const inverted = parseYamlBoolean(invertedValue);
  // An inverted that isn't a readable boolean (a ``${var}``) can't be
  // classified — don't claim a preset over it.
  if (invertedSet && inverted === null) return { kind: "custom" };
  if (Object.keys(flags).length === 0) {
    // An explicit ``inverted: false`` is what the toggle writes when
    // switched back off — semantically unset, not a custom choice.
    if (inverted === true) return { kind: "custom" };
    const implied: Record<string, boolean> | null =
      pinMode === PinMode.INPUT
        ? { input: true }
        : pinMode === PinMode.OUTPUT
          ? { output: true }
          : null;
    const preset =
      implied &&
      presets
        .filter((p) => sameFlagSet(implied, p.flags))
        .find((p) => p.invertedMatch !== true);
    return preset ? { kind: "preset", preset, implicit: true } : { kind: "default" };
  }
  const flagMatches = presets.filter((p) => sameFlagSet(flags, p.flags));
  if (flagMatches.length === 0) return { kind: "custom" };
  const match =
    flagMatches.find((p) => p.invertedMatch === (inverted ?? false)) ??
    flagMatches.find((p) => p.invertedMatch === null);
  return match ? { kind: "preset", preset: match } : { kind: "custom" };
}

/** Why *preset* can't be used on *pin*; ``null`` when it can. An
 *  input-only pin (ESP32 GPIO34–39) has no internal pull resistors and no
 *  output driver, so any preset needing either is out. */
export function presetUnavailableReason(
  preset: WiringPreset,
  pin: BoardPin | null
): "input_only" | null {
  if (!pin?.features.includes(PinFeature.INPUT_ONLY)) return null;
  const f = preset.flags;
  return f.pullup || f.pulldown || f.output || f.open_drain ? "input_only" : null;
}

/** The long-form pin object picking *preset* produces from *current*
 *  (which may still be the scalar short form). Unrelated keys — the
 *  provider key, ``allow_other_uses``, ``drive_strength`` — survive. */
export function applyPresetToPin(
  preset: WiringPreset,
  current: unknown
): Record<string, unknown> {
  const base: Record<string, unknown> = isPlainObject(current)
    ? { ...current }
    : current !== undefined && current !== null && current !== ""
      ? { number: current }
      : {};
  base.mode = { ...preset.flags };
  if (preset.invertedWrite === true) base.inverted = true;
  else if (preset.invertedWrite === false) delete base.inverted;
  return base;
}

/** Compact technical form of a flag set ("input + pullup · inverted") so
 *  advanced users can read what a preset writes at a glance. */
export function wiringTechSummary(
  flags: Readonly<Record<string, boolean>>,
  inverted: boolean
): string {
  const parts = Object.keys(flags).filter((k) => flags[k]);
  const joined = parts.join(" + ");
  if (!inverted) return joined;
  return joined ? `${joined} · inverted` : "inverted";
}

function sameFlagSet(
  flags: Record<string, boolean>,
  target: Readonly<Record<string, boolean>>
): boolean {
  const keys = Object.keys(flags);
  return keys.length === Object.keys(target).length && keys.every((k) => target[k]);
}
