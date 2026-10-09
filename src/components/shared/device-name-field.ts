import { html, nothing, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import type { LocalizeFunc } from "../../common/localize.js";
import {
  getDeviceNameWarning,
  validateDeviceName,
} from "../../util/config-validation.js";
import { renderInlineError } from "../../util/render-error.js";

/** The localizable (code, params) subset of ``ValidationError``. */
export interface DeviceNameMessage {
  code: string;
  params?: Record<string, string | number>;
}

export interface DeviceNameValidity {
  err: DeviceNameMessage | null;
  warning: DeviceNameMessage | null;
}

/**
 * Standard messaging precedence for a device-name input: nothing until
 * *showsValidation*, a hard error owns the slot, a warning renders only
 * error-free.
 */
export function deviceNameValidity(
  name: string,
  showsValidation: boolean
): DeviceNameValidity {
  const err = showsValidation ? validateDeviceName(name) : null;
  const warning = showsValidation && !err ? getDeviceNameWarning(name) : null;
  return { err, warning };
}

export interface DeviceNameFieldOptions {
  localize: LocalizeFunc;
  labelKey: string;
  value: string;
  validity: DeviceNameValidity;
  onInput: (value: string) => void;
  /** Input id (and the label's ``for``); omit for an unassociated label. */
  id?: string;
  placeholder?: string;
  /** Focus this input on open (default true); pass false when another field leads. */
  autofocus?: boolean;
  readonly?: boolean;
  /** Helper text shown while the slot holds neither an error nor a warning. */
  helperKey?: string;
  /** Rendered after the label text, on the label row (a help chip). */
  labelSuffix?: TemplateResult;
}

/** The labelled device-name input plus its inline error / warning slot
 *  (classes from ``dialogFieldStyles`` + ``inputStyles``). */
export function renderDeviceNameField(o: DeviceNameFieldOptions): TemplateResult {
  const { err, warning } = o.validity;
  return html`
    <div class="field">
      ${
        o.labelSuffix
          ? html`<div class="label-row">
              <label for=${o.id ?? nothing}>${o.localize(o.labelKey)}</label>
              ${o.labelSuffix}
            </div>`
          : html`<label for=${o.id ?? nothing}>${o.localize(o.labelKey)}</label>`
      }
      <input
        id=${o.id ?? nothing}
        type="text"
        ?autofocus=${o.autofocus ?? true}
        ?readonly=${o.readonly ?? false}
        class=${err ? "invalid" : ""}
        .value=${live(o.value)}
        placeholder=${o.placeholder ?? nothing}
        @input=${(e: Event) => o.onInput((e.target as HTMLInputElement).value)}
      />
      ${
        err
          ? renderInlineError(o.localize(err.code, err.params))
          : warning
            ? html`<span class="field-warning"
                >${o.localize(warning.code, warning.params)}</span
              >`
            : o.helperKey
              ? html`<span class="helper">${o.localize(o.helperKey)}</span>`
              : nothing
      }
    </div>
  `;
}
