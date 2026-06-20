/**
 * Bespoke renderer + state helpers for the ``delay`` action.
 *
 * The catalog exposes Delay as six separate string fields
 * (``days``, ``hours``, ``minutes``, ``seconds``, ``milliseconds``,
 * ``microseconds``) all tagged advanced + optional, but
 * semantically only one knob is being set — the user picks a
 * unit and types a number. Surfacing six empty inputs invites
 * filling several of them by accident and looks nothing like
 * the single ``interval: 5s`` widget the interval automation
 * already uses.
 *
 * Replace it with a number + unit pair. On write we put the
 * value into the matching catalog field and clear the others;
 * on read we pick whichever field carries a value and split it
 * back into number + unit. ``delay: 2s`` written by the
 * backend's shortcut writer lands as ``params.id = "2s"`` —
 * fall back to that key as a last resort so we don't lose
 * historic shortcut values when the user opens the editor.
 *
 * Delay is also templatable: ``delay: !lambda "..."`` lands as a
 * lambda sentinel under ``params.id``. A literal/lambda toggle
 * (matching the templatable field UX) swaps the number + unit pair
 * for the C++ editor so the lambda is visible and round-trips.
 *
 * The render entry point ``renderDelayParams`` paints into the host
 * action node's shadow root (so its ``static styles`` still apply);
 * the pure read/write helpers below are the host's state plumbing.
 */
import { html, type TemplateResult } from "lit";

import type { LambdaValue } from "../../../api/types/automations.js";
import { isLambdaValue } from "../../../api/types/automations.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import {
  looksLikeTimePeriodScalar,
  parseTimePeriodScalar,
  TIME_PERIOD_UNITS,
  type TimePeriodUnit,
} from "../../../util/time-period.js";
import { lambdaBodyOf } from "../config-entry-renderers/lambda.js";
import { renderLiteralLambdaToggle } from "../config-entry-renderers/literal-lambda-toggle.js";

/** Time units the Delay action picker offers (the shared canonical
 *  set, least → most coarse). */
export const DELAY_UNITS = TIME_PERIOD_UNITS;
export type DelayUnit = TimePeriodUnit;

/** Maps each picker unit to the catalog field key the backend's
 *  YAML writer expects. ESPHome's time_period coercer accepts any
 *  of these; we always write through exactly one. */
const DELAY_UNIT_TO_KEY: Record<DelayUnit, string> = {
  us: "microseconds",
  ms: "milliseconds",
  s: "seconds",
  min: "minutes",
  h: "hours",
  d: "days",
};

/** The Delay value when it is a ``!lambda`` (the templatable form),
 *  else null. The backend lands a scalar delay under ``params.id``. */
export function delayLambdaOf(params: Record<string, unknown>): LambdaValue | null {
  const id = params.id;
  return isLambdaValue(id) ? id : null;
}

/** Pick a (numeric value, unit) pair out of the delay action's
 *  params dict. Falls back to seconds when no field is set. */
export function readDelay(params: Record<string, unknown>): {
  value: string;
  unit: DelayUnit;
} {
  for (const u of DELAY_UNITS) {
    const key = DELAY_UNIT_TO_KEY[u];
    const v = params[key];
    if (v !== undefined && v !== "" && v !== null) {
      return { value: String(v), unit: u };
    }
  }
  // Backend shortcut form: ``delay: 2s`` → ``params.id = "2s"``.
  // Split into numeric value + canonical unit (honouring ESPHome's
  // ``sec`` / ``seconds`` / ... aliases) so the picker doesn't blank
  // out for round-tripped values. Requires an explicit unit — ESPHome
  // rejects a bare-number delay, so we don't pretend ``5`` is seconds.
  const shortcut = params.id;
  if (typeof shortcut === "string" && looksLikeTimePeriodScalar(shortcut)) {
    const parsed = parseTimePeriodScalar(shortcut);
    return { value: parsed.value, unit: parsed.unit };
  }
  return { value: "", unit: "s" };
}

/** A copy of the params with every delay slot removed — the six unit
 *  fields and the ``id`` scalar shorthand — so a writer can set
 *  exactly one form (value + unit, or lambda) without the others
 *  lingering as a competing value. */
export function clearedDelayParams(
  params: Record<string, unknown>
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...params };
  for (const u of DELAY_UNITS) delete next[DELAY_UNIT_TO_KEY[u]];
  delete next.id;
  return next;
}

/** Next params for a (numeric value, unit) pair, using the canonical
 *  ``<unit>: <value>`` form. */
export function writeDelayParams(
  params: Record<string, unknown>,
  value: string,
  unit: DelayUnit
): Record<string, unknown> {
  const trimmed = value.trim();
  const next = clearedDelayParams(params);
  if (trimmed) next[DELAY_UNIT_TO_KEY[unit]] = trimmed;
  return next;
}

/** Next params for a ``!lambda`` body in the scalar ``id`` slot. The
 *  explicit ``!lambda`` tag is what makes the backend re-emit a lambda
 *  rather than a string literal. */
export function writeDelayLambdaParams(
  params: Record<string, unknown>,
  body: string
): Record<string, unknown> {
  const next = clearedDelayParams(params);
  next.id = { _lambda: body, _tag: "!lambda" };
  return next;
}

export interface DelayParamsProps {
  params: Record<string, unknown>;
  disabled: boolean;
  localize: LocalizeFunc;
  onWrite: (value: string, unit: DelayUnit) => void;
  onWriteLambda: (body: string) => void;
  onToggle: (toLambda: boolean) => void;
}

export function renderDelayParams(p: DelayParamsProps): TemplateResult {
  const lambda = delayLambdaOf(p.params);
  return html`<div class="ae-delay">
    ${renderLiteralLambdaToggle({
      isLambda: lambda !== null,
      disabled: p.disabled,
      localize: p.localize,
      onSwitch: (toLambda) => p.onToggle(toLambda),
    })}
    ${lambda ? renderDelayLambda(lambda, p) : renderDelayLiteral(p)}
  </div>`;
}

function renderDelayLiteral(p: DelayParamsProps): TemplateResult {
  const { value: numericValue, unit } = readDelay(p.params);
  return html`<div class="ae-delay-row">
    <div class="ae-delay-value">
      <label class="field-label" for="ae-delay-value-input">
        ${p.localize("device.automation_action_delay_value")}
      </label>
      <input
        id="ae-delay-value-input"
        type="text"
        inputmode="decimal"
        .value=${numericValue}
        placeholder="0"
        ?disabled=${p.disabled}
        @input=${(e: Event) => p.onWrite((e.target as HTMLInputElement).value, unit)}
      />
    </div>
    <div class="ae-delay-unit">
      <label class="field-label" id="ae-delay-unit-label">
        ${p.localize("device.automation_action_delay_unit")}
      </label>
      <wa-select
        id="ae-delay-unit-select"
        aria-labelledby="ae-delay-unit-label"
        value=${unit}
        ?disabled=${p.disabled}
        @change=${(e: Event) =>
          p.onWrite(numericValue, (e.target as HTMLSelectElement).value as DelayUnit)}
      >
        ${DELAY_UNITS.map(
          (u) =>
            html`<wa-option value=${u} ?selected=${u === unit}>
              ${p.localize(`device.automation_action_delay_unit_${u}`)}
            </wa-option>`
        )}
      </wa-select>
    </div>
  </div>`;
}

function renderDelayLambda(lambda: LambdaValue, p: DelayParamsProps): TemplateResult {
  return html`<esphome-lambda-editor
    .value=${lambdaBodyOf(lambda)}
    ?disabled=${p.disabled}
    @lambda-change=${(e: CustomEvent<{ value: string }>) =>
      p.onWriteLambda(e.detail.value)}
  ></esphome-lambda-editor>`;
}
