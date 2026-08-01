/**
 * The troubleshoot dialog's "Set the address manually" screen: current
 * value, ownership warning, the validated `use_address` write/remove
 * flows, and the packaged-config snippet fallback. Split from
 * `troubleshoot-dialog.ts` for file size; state stays on the host.
 */
import { html, nothing, type TemplateResult } from "lit";
import type { ConfiguredDevice } from "../../api/types/devices.js";
import { copyToClipboard } from "../../util/copy-to-clipboard.js";
import { notifyError, notifySuccess } from "../../util/notify.js";
import { USE_ADDRESS_DOCS_URL } from "../../util/troubleshoot-tree.js";
import {
  applyUseAddress,
  isValidUseAddress,
  readAddressPrefill,
  removeUseAddress,
} from "../../util/use-address-yaml.js";
import type { ESPHomeTroubleshootDialog } from "../troubleshoot-dialog.js";

export function renderAddressScreen(
  host: ESPHomeTroubleshootDialog,
  device: ConfiguredDevice | undefined
): TemplateResult {
  if (host._saveState === "saved" || host._saveState === "removed") {
    return html`
      <div class="section" data-section="use_address">
        <div class="saved-panel">
          <wa-icon library="mdi" name="check-circle"></wa-icon>
          <p>
            ${host._localize(
              host._saveState === "removed"
                ? "troubleshoot.use_address_removed"
                : "troubleshoot.use_address_saved"
            )}
          </p>
        </div>
        <div class="actions">
          <button class="btn btn--confirm" @click=${() => host.close()}>
            ${host._localize("layout.close")}
          </button>
        </div>
      </div>
    `;
  }
  return html`
    <div class="section" data-section="use_address">
      ${
        host._existingAddress
          ? html`<p>
              ${host._localize("troubleshoot.use_address_current", {
                address: host._existingAddress,
              })}
            </p>`
          : nothing
      }
      <p>
        ${host._localize("troubleshoot.use_address_body")}
        <a href=${USE_ADDRESS_DOCS_URL} target="_blank" rel="noopener noreferrer">
          ${host._localize("troubleshoot.learn_more")}
          <wa-icon library="mdi" name="open-in-new"></wa-icon>
        </a>
      </p>
      <p class="warning-banner">
        ${host._localize("troubleshoot.use_address_ownership")}
      </p>
      ${device ? renderUseAddressForm(host, device) : nothing}
    </div>
  `;
}

function renderUseAddressForm(
  host: ESPHomeTroubleshootDialog,
  device: ConfiguredDevice
): TemplateResult {
  if (host._saveState === "snippet") {
    // Bare key only: the include target is the section's mapping body,
    // so a `wifi:` header pasted there would nest one level too deep.
    const value = host._addressInput.trim();
    const snippet = `use_address: ${value.includes(":") ? `"${value}"` : value}`;
    return html`
      <p>${host._localize("troubleshoot.use_address_snippet")}</p>
      <pre class="snippet">${snippet}</pre>
      <div class="actions">
        <button
          class="btn btn--confirm"
          @click=${async () => {
            // The helper's contract: surface a toast either way; the
            // execCommand fallback can fail silently on plain HTTP.
            if (await copyToClipboard(snippet)) {
              notifySuccess(host._localize("troubleshoot.use_address_copied"));
            } else {
              notifyError(host._localize("troubleshoot.use_address_copy_failed"));
            }
          }}
        >
          ${host._localize("troubleshoot.use_address_copy")}
        </button>
      </div>
    `;
  }
  const placeholder = device.ip || host._result?.ping_target || "192.168.1.50";
  return html`
    <label class="address-label" for="use-address-input">
      <code>use_address</code>
      <span>${host._localize("troubleshoot.use_address_label")}</span>
    </label>
    <div class="address-form">
      <input
        id="use-address-input"
        type="text"
        class=${host._addressInvalid ? "invalid" : ""}
        .value=${host._addressInput}
        placeholder=${placeholder}
        @input=${(e: Event) => {
          host._addressInput = (e.target as HTMLInputElement).value;
          host._addressInvalid = false;
          if (host._saveState === "error") host._saveState = "idle";
        }}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter") void saveUseAddress(host);
        }}
      />
    </div>
    ${
      host._addressInvalid
        ? html`<p class="field-error">
            ${host._localize("troubleshoot.use_address_invalid")}
          </p>`
        : nothing
    }
    ${
      host._saveState === "error"
        ? html`<p class="field-error">
            ${host._localize("troubleshoot.use_address_error")}
          </p>`
        : nothing
    }
    ${
      host._saveState === "no_network"
        ? html`<p class="field-error">
            ${host._localize("troubleshoot.use_address_no_network")}
          </p>`
        : nothing
    }
    ${
      host._saveState === "remove_packaged"
        ? html`<p class="field-error">
            ${host._localize("troubleshoot.use_address_remove_packaged")}
          </p>`
        : nothing
    }
    <div class="actions">
      ${
        host._existingAddress
          ? html`<button
              class="btn btn--cancel"
              ?disabled=${host._saveState === "saving"}
              @click=${() => void clearUseAddress(host)}
            >
              ${host._localize("troubleshoot.use_address_remove")}
            </button>`
          : nothing
      }
      <button
        class="btn btn--confirm"
        ?disabled=${host._saveState === "saving"}
        @click=${() => void saveUseAddress(host)}
      >
        ${host._localize("troubleshoot.use_address_save")}
      </button>
    </div>
  `;
}

// Both writers capture the configuration up front and guard every
// resumption: a dialog reopened for another device mid-flight must
// not write the old device's YAML or state (same shape as the host's
// _runCheck).

async function saveUseAddress(host: ESPHomeTroubleshootDialog): Promise<void> {
  const configuration = host._configuration;
  const value = host._addressInput.trim();
  if (!isValidUseAddress(value)) {
    host._addressInvalid = true;
    return;
  }
  host._saveState = "saving";
  try {
    const yaml = await host._api.getConfig(configuration);
    if (configuration !== host._configuration) return;
    const device = host._devices.find((d) => d.configuration === configuration);
    const result = applyUseAddress(yaml, value, device?.loaded_integrations ?? []);
    if ("snippet" in result) {
      host._saveState = "snippet";
      return;
    }
    if ("noNetwork" in result) {
      host._saveState = "no_network";
      return;
    }
    await host._api.updateConfig(configuration, result.yaml);
    if (configuration !== host._configuration) return;
    // Keep both screens consistent with the write Back can return to.
    host._existingAddress = value;
    host._saveState = "saved";
  } catch {
    if (configuration === host._configuration) host._saveState = "error";
  }
}

async function clearUseAddress(host: ESPHomeTroubleshootDialog): Promise<void> {
  const configuration = host._configuration;
  host._saveState = "saving";
  try {
    const yaml = await host._api.getConfig(configuration);
    if (configuration !== host._configuration) return;
    const updated = removeUseAddress(yaml);
    if (updated === null) {
      host._saveState = "remove_packaged";
      return;
    }
    if (updated !== yaml) {
      await host._api.updateConfig(configuration, updated);
      if (configuration !== host._configuration) return;
    }
    host._existingAddress = "";
    host._addressInput = "";
    host._saveState = "removed";
  } catch {
    if (configuration === host._configuration) host._saveState = "error";
  }
}

export async function loadExistingAddress(
  host: ESPHomeTroubleshootDialog
): Promise<void> {
  const configuration = host._configuration;
  try {
    const yaml = await host._api.getConfig(configuration);
    if (configuration !== host._configuration) return;
    const { useAddress, staticIp } = readAddressPrefill(yaml);
    // Only a verified YAML read drives the diagnosis; a packaged
    // network block (null) leaves the prefill hint as just a hint.
    if (useAddress !== null && useAddress !== host._existingAddress) {
      const inputUntouched =
        host._addressInput === "" || host._addressInput === host._existingAddress;
      host._existingAddress = useAddress;
      // A raw `${substitution}` or `!secret` value would fail the
      // validator the moment the user hits Save; skip the prefill.
      if (inputUntouched && isValidUseAddress(useAddress)) {
        host._addressInput = useAddress;
      }
    }
    if (!host._addressInput && staticIp !== null && isValidUseAddress(staticIp)) {
      host._addressInput = staticIp;
    }
  } catch {
    // Keep the heuristic; the save path re-fetches anyway.
  }
}
