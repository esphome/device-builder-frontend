/**
 * The pin ``mode`` machinery behind the wiring section: the guided
 * Custom pane, the raw long-form child rendering (provider scoping,
 * scalar-shorthand expansion), and the shared micro-schematic helper.
 * Split from ``config-entry-pin-wiring.ts`` to keep both under the
 * repo's file-size limit.
 */

import { html, nothing, type TemplateResult } from "lit";
import type { ConfigEntry } from "../../api/types/config-entries.js";
import { ConfigEntryType } from "../../api/types/config-entries.js";
import { withBase } from "../../util/base-path.js";
import { isPlainObject } from "../../util/nested-values.js";
import { expandPinModeShorthand } from "../../util/pin-mode.js";
import { KNOWN_MODE_FLAGS, modeFlagsOf } from "../../util/pin-wiring-presets.js";
import { looksLikeSubstitution } from "../../util/substitutions.js";
import { type RenderCtx } from "./config-entry-renderers-shared.js";
import { renderNestedField } from "./config-entry-renderers/nested.js";
import { renderBooleanField } from "./config-entry-renderers/primitives.js";

/** Decorative micro-schematic for a preset card or custom-editor row,
 *  from the bundled ``assets/pin-wiring/<name>.svg`` files. Applied as a
 *  CSS mask so the drawing takes the theme's text color in both modes. */
export function wiringDiagram(name: string): TemplateResult {
  const url = withBase(`/assets/pin-wiring/${name}.svg`);
  return html`<span
    class="pin-wiring-diagram pin-wiring-diagram--mask"
    style="-webkit-mask-image: url('${url}'); mask-image: url('${url}')"
    aria-hidden="true"
  ></span>`;
}

/**
 * The Custom pane: direction and pull resistor as exclusive choices
 * (so ``pullup`` + ``pulldown`` together is unrepresentable from the
 * UI), open drain, and the catalog's ``inverted`` field. A mode value
 * carrying flags outside the native set (``analog``, expander flags)
 * falls back to the raw flag list so nothing becomes uneditable.
 */
export function renderCustomEditor(
  modeChild: ConfigEntry,
  invertedChild: ConfigEntry | undefined,
  path: string[],
  ctx: RenderCtx,
  modeValue: unknown,
  fieldDisabled: boolean,
  inputOnly = false
): TemplateResult {
  const flags = modeFlagsOf(modeValue);
  if (flags === null || Object.keys(flags).some((k) => !KNOWN_MODE_FLAGS.has(k))) {
    return html`<div class="pin-wiring-custom">
      ${renderLongFormChild(modeChild, path, ctx)}
      ${invertedChild ? renderLongFormChild(invertedChild, path, ctx) : nothing}
    </div>`;
  }

  const direction =
    flags.input && flags.output
      ? "both"
      : flags.output
        ? "output"
        : flags.input
          ? "input"
          : "";
  const pull = flags.pullup ? "pullup" : flags.pulldown ? "pulldown" : "none";
  const writeMode = (mutate: (f: Record<string, boolean>) => void) => {
    // Same belt-and-braces as the other mutating handlers: the rendered
    // ``disabled`` attribute alone can't stop a synthetic event.
    if (fieldDisabled) return;
    const next = { ...flags };
    mutate(next);
    for (const key of Object.keys(next)) {
      if (!next[key]) delete next[key];
    }
    // A pull-only mode cleared back to None empties the flag set; drop
    // the ``mode:`` key entirely rather than writing an empty mapping.
    ctx.emitChange([...path, "mode"], Object.keys(next).length ? next : undefined);
  };
  // An unexpected radio value (a component shape change) must no-op, not
  // strip the flags it would have replaced.
  const onDirection = (value: string) => {
    if (value !== "input" && value !== "output" && value !== "both") return;
    writeMode((f) => {
      delete f.input;
      delete f.output;
      if (value === "input" || value === "both") f.input = true;
      if (value === "output" || value === "both") f.output = true;
    });
  };
  const onPull = (value: string) => {
    if (value !== "none" && value !== "pullup" && value !== "pulldown") return;
    writeMode((f) => {
      delete f.pullup;
      delete f.pulldown;
      if (value === "pullup") f.pullup = true;
      if (value === "pulldown") f.pulldown = true;
    });
  };

  const uid = `pin-wiring-${path.join("-")}`;
  // On an input-only pin (no output driver, no internal pulls) the
  // unsupported options disable — except the currently-set one, so an
  // invalid legacy config can still be repaired by moving off it.
  const optionDisabled = (value: string, current: string) =>
    inputOnly && value !== current && value !== "input" && value !== "none";
  const radios = (
    labelId: string,
    value: string,
    onChange: (value: string) => void,
    options: Array<[string, string]>
  ) => html`
    <wa-radio-group
      class="pin-wiring-radios"
      aria-labelledby=${labelId}
      .value=${value}
      ?disabled=${fieldDisabled}
      @change=${(e: Event) => onChange((e.target as unknown as { value: string }).value)}
    >
      ${options.map(
        ([v, key]) =>
          html`<wa-radio value=${v} ?disabled=${optionDisabled(v, value)}>
            ${ctx.localize(key)}
          </wa-radio>`
      )}
    </wa-radio-group>
  `;

  return html`
    <div class="pin-wiring-custom">
      <div class="pin-wiring-row">
        <span class="field-label" id="${uid}-direction">
          ${ctx.localize("device.pin_wiring_direction")}
        </span>
        <p class="field-description">
          ${ctx.localize("device.pin_wiring_direction_description")}
        </p>
        ${wiringDiagram("direction")}
        ${radios(`${uid}-direction`, direction, onDirection, [
          ["input", "device.pin_wiring_direction_input"],
          ["output", "device.pin_wiring_direction_output"],
          ["both", "device.pin_wiring_direction_both"],
        ])}
      </div>
      <div class="pin-wiring-row">
        <span class="field-label" id="${uid}-pull">
          ${ctx.localize("device.pin_wiring_pull")}
        </span>
        <p class="field-description">
          ${ctx.localize("device.pin_wiring_pull_description")}
        </p>
        ${wiringDiagram("pull_resistor")}
        ${radios(`${uid}-pull`, pull, onPull, [
          ["none", "device.pin_wiring_pull_none"],
          ["pullup", "device.pin_wiring_pull_up"],
          ["pulldown", "device.pin_wiring_pull_down"],
        ])}
      </div>
      ${
        flags.open_drain || direction === "output" || direction === "both"
          ? html`<div class="switch-field">
              <div class="field-info">
                <label class="field-label">
                  ${ctx.localize("device.pin_wiring_open_drain")}
                </label>
                <p class="field-description">
                  ${ctx.localize("device.pin_wiring_open_drain_description")}
                </p>
              </div>
              <wa-switch
                ?checked=${!!flags.open_drain}
                ?disabled=${fieldDisabled}
                aria-label=${ctx.localize("device.pin_wiring_open_drain")}
                @change=${(e: Event) =>
                  writeMode((f) => {
                    f.open_drain = (
                      e.target as HTMLInputElement & { checked: boolean }
                    ).checked;
                  })}
              ></wa-switch>
            </div>`
          : nothing
      }
      ${invertedChild ? renderLongFormChild(invertedChild, path, ctx) : nothing}
    </div>
  `;
}

/** Render one long-form pin field; the ``mode`` group is scoped to the flags
 *  the pin's external provider allows (a native / unknown provider keeps all). */
export function renderLongFormChild(
  child: ConfigEntry,
  path: string[],
  ctx: RenderCtx
): unknown {
  if (child.key !== "mode" || child.type !== ConfigEntryType.NESTED) {
    return ctx.renderEntry(child, [...path, child.key]);
  }
  const modePath = [...path, child.key];
  const modeValue = ctx.getAt(modePath);
  const allowed = providerAllowedModes(ctx.getAt(path), ctx.pinRegistryModes);
  // Keep any flag the value already sets visible even if the provider now
  // disallows it, so a legacy/invalid config can be repaired from the editor.
  // Callers hand in entries whose ``advanced`` marks are already
  // stripped (the wiring section is itself the advanced gate), so the
  // scoped copy renders fully without the global toggle.
  const scoped = allowed
    ? scopeModeChildren(child, allowed, presentModeFlags(modeValue))
    : child;
  // A scalar shorthand (``mode: OUTPUT``) needs the display-expansion
  // wrapper; a ``${var}`` scalar goes through renderEntry so the form's
  // substitution gate edits it as text with the resolves-to hint (#1343);
  // the object form goes through the normal nested dispatch. Deliberately
  // ``looksLikeSubstitution``, not ``isSubstitutionString`` — the typeof
  // guard is load-bearing (an object mode must not hit the wrapper).
  return typeof modeValue === "string" && !looksLikeSubstitution(modeValue)
    ? renderPinModeField(scoped, modePath, ctx)
    : ctx.renderEntry(scoped, modePath);
}

/** Allowed mode flags for *pinValue*'s provider, or ``null`` (native pin,
 *  short form, unknown provider, or empty list) to keep the full flag set. */
export function providerAllowedModes(
  pinValue: unknown,
  modesMap: Record<string, string[]> | undefined
): string[] | null {
  if (!modesMap || !isPlainObject(pinValue)) return null;
  for (const key of Object.keys(pinValue)) {
    // Own-property check, not ``in``, so a key like ``toString`` can't match
    // an inherited member. An empty list means no scoping (show every flag).
    if (Object.prototype.hasOwnProperty.call(modesMap, key)) {
      const allowed = modesMap[key];
      return allowed.length > 0 ? allowed : null;
    }
  }
  return null;
}

/** Flag keys the current ``mode`` value sets (object keys, or a scalar
 *  shorthand's expansion) — kept visible so a legacy flag stays editable. */
function presentModeFlags(modeValue: unknown): string[] {
  if (typeof modeValue === "string") {
    return Object.keys(expandPinModeShorthand(modeValue) ?? {});
  }
  return isPlainObject(modeValue) ? Object.keys(modeValue) : [];
}

/** *modeEntry* with its flag children narrowed to *allowed* plus any flag
 *  *present* already sets, so a disallowed-but-set flag stays editable. */
function scopeModeChildren(
  modeEntry: ConfigEntry,
  allowed: string[],
  present: string[]
): ConfigEntry {
  const keep = new Set([...allowed, ...present]);
  const children = (modeEntry.config_entries ?? []).filter((c) => keep.has(c.key));
  return { ...modeEntry, config_entries: children };
}

/**
 * Render the pin ``mode`` group. A scalar shorthand (``mode: OUTPUT``)
 * is expanded to its flag dict for display so the existing checkboxes
 * reflect it; the YAML scalar is kept until the user toggles a flag,
 * which writes the flag-object form. Object form and unrecognised
 * shorthands fall through to the normal nested renderer.
 */
function renderPinModeField(
  entry: ConfigEntry,
  modePath: string[],
  ctx: RenderCtx
): unknown {
  const raw = ctx.getAt(modePath);
  const expanded = typeof raw === "string" ? expandPinModeShorthand(raw) : null;
  if (!expanded) return renderNestedField(entry, modePath, ctx);
  return renderNestedField(entry, modePath, pinModeDisplayCtx(ctx, modePath, expanded));
}

/** Wrap *ctx* so reads under *modePath* see *expanded* (a flag dict from a
 *  scalar shorthand) and a flag-child write promotes the mode to the
 *  flag-object form, replacing the scalar only on edit. */
function pinModeDisplayCtx(
  ctx: RenderCtx,
  modePath: string[],
  expanded: Record<string, boolean>
): RenderCtx {
  const modeKey = modePath.join(".");
  const flagOf = (path: string[]): string | null =>
    path.length === modePath.length + 1 &&
    path.slice(0, modePath.length).join(".") === modeKey
      ? path[modePath.length]
      : null;
  const wrapped: RenderCtx = {
    ...ctx,
    getAt: (path) => {
      if (path.join(".") === modeKey) return expanded;
      const flag = flagOf(path);
      return flag !== null ? expanded[flag] : ctx.getAt(path);
    },
    scopeValues: (path) =>
      path.join(".") === modeKey ? { ...expanded } : ctx.scopeValues(path),
    emitChange: (path, value) => {
      const flag = flagOf(path);
      if (flag === null) {
        ctx.emitChange(path, value);
        return;
      }
      const next = { ...expanded };
      if (value) next[flag] = true;
      else delete next[flag];
      ctx.emitChange(modePath, next);
    },
  };
  // The mode children are booleans; render them through the wrapper so the
  // checkboxes read/write the expanded flags.
  wrapped.renderEntry = (child, path) =>
    child.type === ConfigEntryType.BOOLEAN
      ? renderBooleanField(child, path, wrapped)
      : ctx.renderEntry(child, path);
  return wrapped;
}
