/**
 * The troubleshoot dialog's "Set the address manually" screen: current
 * value, ownership warning, the validated `use_address` write/remove
 * flows, and the packaged-config snippet fallback. Split from
 * `troubleshoot-dialog.ts` for file size; state stays on the host.
 */
import { html, nothing, type TemplateResult } from "lit";
import type { ConfiguredDevice } from "../../api/types/devices.js";
import { USE_ADDRESS_DOCS_URL } from "../../util/troubleshoot-tree.js";
import {
  applyUseAddress,
  isValidUseAddress,
  readStaticIp,
  readUseAddress,
  removeUseAddress,
  snippetNetworkSection,
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
    return html`
      <p>${host._localize("troubleshoot.use_address_snippet")}</p>
      <pre class="snippet">
${host._snippetSection}:
  use_address: ${host._addressInput.trim()}</pre>
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
              class="btn btn--remove"
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
    const updated = applyUseAddress(yaml, value);
    if (updated === null) {
      const device = host._devices.find((d) => d.configuration === configuration);
      host._snippetSection = snippetNetworkSection(
        yaml,
        device?.loaded_integrations ?? []
      );
      host._saveState = "snippet";
      return;
    }
    await host._api.updateConfig(configuration, updated);
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
    const fromYaml = readUseAddress(yaml);
    // A packaged network block (null) keeps the heuristic seed; a
    // spliceable one is authoritative either way.
    if (fromYaml !== null && fromYaml !== host._existingAddress) {
      const inputUntouched = host._addressInput === host._existingAddress;
      host._existingAddress = fromYaml;
      if (inputUntouched) host._addressInput = fromYaml;
    }
    if (!host._addressInput) {
      // The firmware's own manual_ip.static_ip is the best prefill.
      host._addressInput = readStaticIp(yaml) ?? "";
    }
  } catch {
    // Keep the heuristic; the save path re-fetches anyway.
  }
}
