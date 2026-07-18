import { html, nothing, type TemplateResult } from "lit";
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
}

/** The labelled device-name input plus its inline error / warning slot
 *  (classes from ``dialogFieldStyles`` + ``inputStyles``). */
export function renderDeviceNameField(o: DeviceNameFieldOptions): TemplateResult {
  const { err, warning } = o.validity;
  return html`
    <div class="field">
      <label for=${o.id ?? nothing}>${o.localize(o.labelKey)}</label>
      <input
        id=${o.id ?? nothing}
        type="text"
        autofocus
        class=${err ? "invalid" : ""}
        .value=${o.value}
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
            : nothing
      }
    </div>
  `;
}
