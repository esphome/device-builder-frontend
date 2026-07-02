import { type TemplateResult, html, nothing } from "lit";
import type { LocalizeFunc } from "../../common/localize.js";
import { type PasswordInputValueChange } from "../device/password-input-event.js";

import "../device/password-input.js";

/**
 * WPA/WPA2 passphrases are 8-63 chars; an empty password is a valid open
 * network, so only a non-empty value shorter than 8 is rejected. Whitespace
 * is significant, so the length is taken from the raw value.
 */
export function isWifiPasswordTooShort(password: string): boolean {
  return password.length > 0 && password.length < 8;
}

export interface WifiFieldsProps {
  localize: LocalizeFunc;
  ssid: string;
  password: string;
  disabled: boolean;
  onSsidInput: (value: string) => void;
  onPasswordInput: (value: string) => void;
}

/**
 * SSID + password inputs shared by the first-run wizard's Wi-Fi step and the
 * standalone credential-rotation dialog so the two never drift.
 */
export function renderWifiFields(props: WifiFieldsProps): TemplateResult {
  const { localize, ssid, password, disabled } = props;
  const tooShort = isWifiPasswordTooShort(password);
  return html`
    <div class="field">
      <label for="onboarding-ssid">${localize("onboarding.wifi.ssid_label")}</label>
      <input
        id="onboarding-ssid"
        type="text"
        .value=${ssid}
        maxlength="32"
        placeholder=${localize("onboarding.wifi.ssid_placeholder")}
        ?disabled=${disabled}
        @input=${(e: Event) => props.onSsidInput((e.target as HTMLInputElement).value)}
      />
    </div>
    <div class="field">
      <!-- Plain span, not <label for>: esphome-password-input is a custom
           element the platform won't focus on label click; its accessible name
           comes from the .label prop (forwarded to the inner input). -->
      <span class="field-label">${localize("onboarding.wifi.password_label")}</span>
      <esphome-password-input
        .value=${password}
        .placeholder=${localize("onboarding.wifi.password_placeholder")}
        .maxlength=${64}
        .label=${localize("onboarding.wifi.password_label")}
        .invalid=${tooShort}
        .describedby=${tooShort ? "onboarding-password-error" : ""}
        ?disabled=${disabled}
        @password-input-change=${(e: CustomEvent<PasswordInputValueChange>) =>
          props.onPasswordInput(e.detail.value)}
      ></esphome-password-input>
      ${
        tooShort
          ? html`<p id="onboarding-password-error" class="error" role="alert">
              ${localize("onboarding.wifi.password_too_short")}
            </p>`
          : nothing
      }
    </div>
  `;
}
