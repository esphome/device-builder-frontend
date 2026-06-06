/**
 * Inline "Use secret" picker beside secret-eligible fields. Lists the
 * ``secrets.yaml`` keys (from `secrets-cache.ts`) with the recommended ones
 * for this field grouped on top; picking one emits ``secret-selected`` with
 * the ``!secret <key>`` literal. It can also migrate the field's current
 * inline value into a new secret, and "Create new secret…" routes to the
 * secrets editor. Open state lives in ``wa-dropdown`` so the host's
 * re-renders don't drop it.
 */
import { consume } from "@lit/context";
import {
  mdiCheck,
  mdiChevronDown,
  mdiKeyVariant,
  mdiPlus,
  mdiShieldKeyOutline,
} from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../../api/esphome-api.js";
import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, devicesContext, localizeContext } from "../../context/index.js";
import { navigate } from "../../util/navigation.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { secretValueFromYaml, visibleSecretKeys } from "../../util/secret-eligibility.js";
import {
  fetchSecretKeys,
  getCachedSecretKeys,
  subscribeSecretKeys,
} from "../../util/secrets-cache.js";
import { ensureSecretInYaml } from "../../util/secrets-write.js";

import "@home-assistant/webawesome/dist/components/divider/divider.js";
import "@home-assistant/webawesome/dist/components/dropdown-item/dropdown-item.js";
import "@home-assistant/webawesome/dist/components/dropdown/dropdown.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../secret-reveal.js";

registerMdiIcons({
  check: mdiCheck,
  "chevron-down": mdiChevronDown,
  "key-variant": mdiKeyVariant,
  plus: mdiPlus,
  "shield-key-outline": mdiShieldKeyOutline,
});

const SECRETS_FILE = "secrets.yaml";
/** ``wa-dropdown-item`` value flagging the "Create new secret…" action. */
const CREATE_SENTINEL = "__esphome_create_secret__";
/** Revert to a typed value (drop the `!secret` reference). */
const MANUAL_SENTINEL = "__esphome_manual_value__";
/** Migrate the field's inline value into a new secret. */
const MIGRATE_SENTINEL = "__esphome_migrate_secret__";

/** Detail for the ``secret-selected`` event. */
export interface SecretSelectedDetail {
  /** The literal to write into the field: ``!secret <key>``, or ``""`` to
   *  revert to a manually typed value. */
  value: string;
}

@customElement("esphome-secret-picker")
export class ESPHomeSecretPicker extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext, subscribe: true })
  @state()
  private _api?: ESPHomeAPI;

  /** Configured devices — used to hide other devices' per-device secrets. */
  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  /** Disable the trigger (mirrors the field's effective-disabled state). */
  @property({ type: Boolean })
  disabled = false;

  /** This device's resolved node name, so other devices' `<host>__…` secrets
   *  are filtered out of the list. */
  @property({ attribute: "device-name" })
  deviceName = "";

  /** Span the row instead of hugging its content — set when the field is in
   *  secret mode (no manual input beside it). */
  @property({ type: Boolean, reflect: true })
  full = false;

  /** Field label, for the trigger's accessible name. */
  @property({ attribute: "field-label" })
  fieldLabel = "";

  /** Key the field currently references, shown as the trigger's selection;
   *  empty when the field holds a literal. */
  @property({ attribute: "selected-key" })
  selectedKey = "";

  /** The field's current inline literal value, migrated into a secret on
   *  demand. Empty (or a `!secret` ref) means there's nothing to migrate. */
  @property()
  value = "";

  /** Recommended secret keys for this field, most-preferred first. Grouped on
   *  top of the menu; the first one not yet in secrets.yaml is the migrate
   *  target. */
  @property({ attribute: false })
  recommendedKeys: string[] = [];

  @state()
  private _keys: string[] = getCachedSecretKeys() ?? [];

  private _unsub?: () => void;
  private _kicked = false;

  connectedCallback(): void {
    super.connectedCallback();
    // The shared cache owns the `secrets-saved` refresh (deduped, once for all
    // pickers); we just repaint when its list changes.
    this._unsub = subscribeSecretKeys(() => {
      this._keys = getCachedSecretKeys() ?? [];
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unsub?.();
    this._unsub = undefined;
  }

  protected updated(): void {
    // Kick the shared fetch once, when the api context first lands — the
    // cache + subscribe handle dedupe and the repaint.
    if (this._api && !this._kicked) {
      this._kicked = true;
      void fetchSecretKeys(this._api);
    }
  }

  /** The key a migrate would create: always the preferred (first) form, never
   *  the single-underscore back-compat alias — that exists only to recognise
   *  secrets created before the `__` convention, and must not be created anew. */
  private get _migrateTarget(): string {
    return this.recommendedKeys[0] ?? "";
  }

  /** Whether the field holds an inline value worth migrating to a new secret.
   *  Suppressed when the preferred key already exists (select it instead of
   *  creating a duplicate). */
  private get _canMigrate(): boolean {
    return (
      this.selectedKey === "" &&
      this.value !== "" &&
      this._migrateTarget !== "" &&
      !this._keys.includes(this._migrateTarget)
    );
  }

  static styles = css`
    :host {
      display: inline-flex;
    }

    :host([full]) {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: var(--wa-space-2xs);
      width: 100%;
    }

    :host([full]) wa-dropdown,
    :host([full]) .trigger {
      width: 100%;
    }

    :host([full]) .chevron {
      margin-left: auto;
    }

    /* Inline reveal of the selected secret's value (eye + copy). */
    .selected-reveal {
      display: flex;
      align-items: center;
      gap: var(--wa-space-xs);
      padding-left: var(--wa-space-2xs);
      font-size: var(--wa-font-size-xs);
      color: var(--wa-color-text-quiet);
    }

    .trigger {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0 10px;
      min-height: 34px;
      box-sizing: border-box;
      background: transparent;
      border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      border-radius: var(--wa-border-radius-m);
      color: var(--wa-color-text-quiet);
      font-family: inherit;
      font-size: var(--wa-font-size-xs);
      white-space: nowrap;
      cursor: pointer;
      transition:
        background 0.12s,
        border-color 0.12s,
        color 0.12s;
    }

    .trigger:hover:not(:disabled) {
      color: var(--esphome-primary);
      border-color: var(--esphome-primary);
      background: var(--esphome-tint);
    }

    /* Reads as a select that's already pointed at a secret. */
    .trigger.selected {
      color: var(--wa-color-text-normal);
      border-color: var(--esphome-primary);
    }

    .trigger:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .trigger .key {
      font-size: 15px;
      color: var(--esphome-primary);
    }

    .trigger .label {
      /* flex + min-width:0 so a long key actually shrinks and ellipsizes
         inside the inline-flex trigger (notably in full / width:100% mode). */
      flex: 1;
      min-width: 0;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .trigger .placeholder {
      color: var(--wa-color-text-quiet);
    }

    .trigger .chevron {
      font-size: 14px;
    }

    /* Keep the menu inside the viewport on small screens and wrap long
       keys / the migrate label instead of overflowing off-screen. */
    wa-dropdown::part(menu) {
      max-width: min(92vw, 340px);
      box-sizing: border-box;
    }

    wa-dropdown-item {
      max-width: min(92vw, 340px);
      box-sizing: border-box;
    }

    wa-dropdown-item::part(label) {
      white-space: normal;
      overflow-wrap: anywhere;
    }

    .group-label {
      display: block;
      padding: var(--wa-space-2xs) var(--wa-space-s) 0;
      font-size: var(--wa-font-size-2xs);
      font-weight: var(--wa-font-weight-semibold);
      color: var(--wa-color-text-quiet);
      text-transform: uppercase;
    }

    .empty {
      color: var(--wa-color-text-quiet);
    }

    .check {
      font-size: 15px;
      color: var(--esphome-primary);
    }

    .create wa-icon,
    .migrate wa-icon {
      font-size: 15px;
    }
  `;

  protected render() {
    const selected = this.selectedKey !== "";
    // Hide other devices' per-device secrets and field-bound shared secrets
    // (wifi_*) not meant for this field. Migrate / _keys membership still use
    // the full unfiltered list.
    const keys = visibleSecretKeys(
      this._keys,
      [...this.recommendedKeys, this.selectedKey],
      this.deviceName,
      this._devices.map((d) => d.name)
    );
    // Set membership so grouping stays linear as the secrets list grows.
    const keySet = new Set(keys);
    const recommendedSet = new Set(this.recommendedKeys);
    const recommended = this.recommendedKeys.filter((k) => keySet.has(k));
    const others = keys.filter((k) => !recommendedSet.has(k));
    return html`
      <wa-dropdown @wa-select=${this._onSelect}>
        <button
          slot="trigger"
          class=${selected ? "trigger selected" : "trigger"}
          type="button"
          ?disabled=${this.disabled}
          aria-label=${this._localize("device.secret_picker_aria", {
            field: this.fieldLabel,
          })}
        >
          <wa-icon class="key" library="mdi" name="key-variant"></wa-icon>
          ${selected
            ? html`<span class="label">${this.selectedKey}</span>`
            : html`<span class="placeholder"
                >${this._localize("device.secret_picker_label")}</span
              >`}
          <wa-icon class="chevron" library="mdi" name="chevron-down"></wa-icon>
        </button>
        ${this._canMigrate
          ? html`<wa-dropdown-item class="migrate" value=${MIGRATE_SENTINEL}>
                <wa-icon slot="icon" library="mdi" name="shield-key-outline"></wa-icon>
                ${this._localize("device.secret_picker_migrate", {
                  key: this._migrateTarget,
                })}
              </wa-dropdown-item>
              <wa-divider role="separator"></wa-divider>`
          : nothing}
        ${recommended.length
          ? html`<small class="group-label" aria-hidden="true"
                >${this._localize("device.secret_picker_related")}</small
              >
              ${recommended.map((k) => this._renderKeyItem(k))}
              ${others.length
                ? html`<small class="group-label" aria-hidden="true"
                    >${this._localize("device.secret_picker_shared")}</small
                  >`
                : nothing}`
          : nothing}
        ${others.map((k) => this._renderKeyItem(k))}
        ${keys.length
          ? nothing
          : html`<wa-dropdown-item class="empty" disabled role="status"
              >${this._localize("device.secret_picker_empty")}</wa-dropdown-item
            >`}
        <wa-divider role="separator"></wa-divider>
        <wa-dropdown-item class="create" value=${CREATE_SENTINEL}>
          <wa-icon slot="icon" library="mdi" name="plus"></wa-icon>
          ${this._localize("device.secret_picker_create")}
        </wa-dropdown-item>
        ${selected
          ? html`<wa-dropdown-item class="manual" value=${MANUAL_SENTINEL}>
              ${this._localize("device.secret_picker_manual")}
            </wa-dropdown-item>`
          : nothing}
      </wa-dropdown>
      ${selected ? this._renderSelectedReveal() : nothing}
    `;
  }

  /** Reveal the selected secret's value inline, so the user can see it without
   *  switching to the secrets editor. The value is fetched lazily on first
   *  reveal (mirrors the `_manual` revert path's read). */
  private _renderSelectedReveal() {
    return html`<div class="selected-reveal">
      <span>${this._localize("device.secret_picker_value")}</span>
      <esphome-secret-reveal
        .resolve=${this._revealSecretValue}
        resetKey=${this.selectedKey}
      ></esphome-secret-reveal>
    </div>`;
  }

  private _revealSecretValue = async (): Promise<string | null> => {
    if (!this._api || !this.selectedKey) return null;
    try {
      const yaml = await this._api.getConfig(SECRETS_FILE);
      return secretValueFromYaml(yaml, this.selectedKey);
    } catch {
      toast.error(this._localize("device.secret_picker_reveal_error"), {
        richColors: true,
      });
      return null;
    }
  };

  private _renderKeyItem(key: string) {
    return html`<wa-dropdown-item
      value=${key}
      aria-selected=${key === this.selectedKey ? "true" : "false"}
    >
      ${key === this.selectedKey
        ? html`<wa-icon slot="icon" class="check" library="mdi" name="check"></wa-icon>`
        : nothing}
      ${key}
    </wa-dropdown-item>`;
  }

  private _onSelect(e: CustomEvent<{ item: Element }>): void {
    const item = e.detail.item as Element & { value?: string };
    // Detect the action items by class, not by their value — a stored secret
    // whose key happened to equal a sentinel string would otherwise hijack the
    // action instead of being referenced.
    const cls = item.classList;
    if (cls?.contains("create")) {
      void navigate("/secrets");
      return;
    }
    if (cls?.contains("migrate")) {
      void this._migrate();
      return;
    }
    if (cls?.contains("manual")) {
      void this._manual();
      return;
    }
    const value = item.value ?? "";
    if (!value) return;
    this._emit(`!secret ${value}`);
  }

  /** Revert to a typed value: inline the referenced secret's current value so
   *  the user can edit it. */
  private async _manual(): Promise<void> {
    // Nothing to dereference — clear to an empty literal so the user can type.
    if (!this._api || !this.selectedKey) {
      this._emit("");
      return;
    }
    try {
      const yaml = await this._api.getConfig(SECRETS_FILE);
      // `null` means the key is genuinely absent (e.g. deleted) — a legitimate
      // empty inline value. A read that *throws* is transient (below).
      this._emit(secretValueFromYaml(yaml, this.selectedKey) ?? "");
    } catch {
      // Keep the `!secret` reference rather than replacing it with a blank
      // literal a save would persist as an empty credential; surface the error.
      toast.error(this._localize("device.secret_picker_manual_error"), {
        richColors: true,
      });
    }
  }

  private _emit(value: string): void {
    this.dispatchEvent(
      new CustomEvent<SecretSelectedDetail>("secret-selected", {
        detail: { value },
        bubbles: true,
        composed: true,
      })
    );
  }

  /** Append the field's inline value to secrets.yaml under the recommended
   *  key, then point the field at it. */
  private async _migrate(): Promise<void> {
    const key = this._migrateTarget;
    if (!this._api || !key || !this.value) return;
    try {
      const { created } = await ensureSecretInYaml(this._api, key, this.value);
      // `created` false = the key already existed (cache was stale / created in
      // another tab); its value may differ from what the user typed, so say
      // "linked" rather than "saved".
      toast[created ? "success" : "info"](
        this._localize(
          created ? "device.secret_picker_migrated" : "device.secret_picker_linked",
          { key }
        ),
        { richColors: true }
      );
      this._emit(`!secret ${key}`);
    } catch (err) {
      console.error("Secret migration failed", err);
      toast.error(this._localize("device.secret_picker_migrate_error"), {
        richColors: true,
      });
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-secret-picker": ESPHomeSecretPicker;
  }
}
