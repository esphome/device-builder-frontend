import { consume } from "@lit/context";
import {
  mdiClose,
  mdiPaletteOutline,
  mdiServerNetwork,
  mdiTranslate,
  mdiVectorDifference,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import { APIError } from "../api/api-error.js";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import { ErrorCode, type IdentityView, type RemoteBuildPeer } from "../api/types.js";
import type { LocalizeFunc, SupportedLocale } from "../common/localize.js";
import { readStoredLocale } from "../common/localize.js";

/** Sentinel meaning "follow browser locale" (no explicit override). */
type LanguageChoice = SupportedLocale | "system";
import {
  apiContext,
  localizeContext,
  remoteBuildEnabledContext,
  yamlDiffButtonContext,
} from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { formatPinSha256 } from "../util/cert-pin-format.js";
import { copyToClipboard } from "../util/copy-to-clipboard.js";
import { registerMdiIcons } from "../util/register-icons.js";
import "./confirm-dialog.js";
import type { ESPHomeConfirmDialog } from "./confirm-dialog.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";

registerMdiIcons({
  close: mdiClose,
  "palette-outline": mdiPaletteOutline,
  "server-network": mdiServerNetwork,
  translate: mdiTranslate,
  "vector-difference": mdiVectorDifference,
});

type Section = "appearance" | "language" | "editor" | "remote_build";

interface SectionDef {
  id: Section;
  icon: string;
  labelKey: string;
}

const SECTIONS: SectionDef[] = [
  { id: "appearance", icon: "palette-outline", labelKey: "settings.appearance" },
  { id: "language", icon: "translate", labelKey: "settings.language" },
  { id: "editor", icon: "vector-difference", labelKey: "layout.editor" },
  {
    id: "remote_build",
    icon: "server-network",
    labelKey: "settings.remote_build",
  },
];

const LANGUAGES: { value: LanguageChoice; labelKey: string }[] = [
  { value: "system", labelKey: "settings.language_system" },
  { value: "en", labelKey: "settings.language_en" },
  { value: "fr", labelKey: "settings.language_fr" },
  { value: "nl", labelKey: "settings.language_nl" },
];

@customElement("esphome-settings-dialog")
export class ESPHomeSettingsDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: yamlDiffButtonContext, subscribe: true })
  @state()
  private _yamlDiffButton = false;

  @consume({ context: remoteBuildEnabledContext, subscribe: true })
  @state()
  private _remoteBuildEnabled = false;

  @consume({ context: apiContext })
  private _api?: ESPHomeAPI;

  // Phase 2b: peer-list state for the Remote builder section.
  // Lazy-loaded the first time the user opens the section
  // (via ``_selectSection`` / ``_loadRemoteBuildPeers``); refreshed
  // after every add / remove. Reset to ``null`` on dialog open
  // so a fresh visit re-fetches. ``null`` means "not yet loaded";
  // an empty array means "loaded and there are zero peers".
  @state()
  private _remoteBuildPeers: RemoteBuildPeer[] | null = null;

  @state()
  private _remoteBuildHostInput = "";

  @state()
  private _remoteBuildPortInput = "6052";

  @state()
  private _remoteBuildAddInFlight = false;

  // Phase 3c2b: receiver identity (cert pin + listener-bound + versions).
  // Lazy-loaded the first time the user opens the section,
  // refreshed after a successful rotate. ``null`` means
  // "not yet loaded"; an explicit error state is tracked
  // separately so the UI can render a "couldn't load — try
  // re-opening Settings" message rather than spinning forever.
  @state()
  private _remoteBuildIdentity: IdentityView | null = null;

  @state()
  private _remoteBuildIdentityLoadFailed = false;

  // Gates concurrent rotate clicks so a double-click can't
  // fire two ``rotate_identity`` requests. The backend itself
  // rejects the second with ``ALREADY_EXISTS`` (3c1's
  // single-flight contract), but disabling the button is the
  // user-facing equivalent.
  @state()
  private _remoteBuildRotateInFlight = false;

  @query("#rotate-confirm")
  private _rotateConfirmDialog!: ESPHomeConfirmDialog;

  @state()
  private _section: Section = "appearance";

  @state()
  private _theme: string = localStorage.getItem("esphome-theme") ?? "system";

  @state()
  private _language: LanguageChoice = readStoredLocale() ?? "system";

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  open() {
    this._theme = localStorage.getItem("esphome-theme") ?? "system";
    this._language = readStoredLocale() ?? "system";
    this._section = "appearance";
    // Drop any stale peer list / identity from a previous open
    // so the user sees the loading state on each fresh dialog
    // visit. Identity in particular can change between opens
    // (operator rotated the cert from another tab); the
    // rotate flow refreshes locally, so a stale value here
    // would look correct without actually being live.
    this._remoteBuildPeers = null;
    this._remoteBuildIdentity = null;
    this._remoteBuildIdentityLoadFailed = false;
    // Reset rotate-in-flight too — the user could have closed
    // the dialog mid-rotate (or while the confirm modal was
    // open), and a stale ``true`` would leave the Rotate
    // button disabled on the next visit. The shared
    // ``<esphome-confirm-dialog>`` handles its own state, so
    // we only reset the flag here.
    this._remoteBuildRotateInFlight = false;
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

  private _selectSection(section: Section) {
    this._section = section;
    if (section === "remote_build") {
      if (this._remoteBuildPeers === null) {
        void (async () => {
          const ok = await this._loadRemoteBuildPeers();
          if (!ok && this._remoteBuildPeers === null) {
            // First-load fallback only — a fresh-open with no prior
            // list still needs *something* renderable. The mutation
            // path below leaves the prior list intact instead.
            this._remoteBuildPeers = [];
          }
        })();
      }
      if (this._remoteBuildIdentity === null && !this._remoteBuildIdentityLoadFailed) {
        void this._loadRemoteBuildIdentity();
      }
    }
  }

  /**
   * Fetch the live peer list and update ``_remoteBuildPeers``.
   *
   * Returns ``true`` when the call landed cleanly so callers can
   * distinguish "list is now fresh" from "couldn't refresh." On
   * failure the previous list value is left in place — clobbering
   * to ``[]`` after a successful add / remove was a real bug
   * (mutation succeeded server-side but the UI showed an empty
   * list, looking like the add had failed). The first-open caller
   * in ``_selectSection`` does its own ``[]`` fallback for the
   * "no prior list to preserve" case.
   *
   * mDNS rows are listed first by the backend; manual rows follow
   * with ``source="manual"``.
   */
  private async _loadRemoteBuildPeers(): Promise<boolean> {
    if (this._api === undefined) {
      return false;
    }
    try {
      this._remoteBuildPeers = await this._api.listRemoteBuildHosts();
      return true;
    } catch (err) {
      console.warn("Could not load remote-build hosts:", err);
      return false;
    }
  }

  /**
   * Fetch the receiver identity for the Build host card.
   *
   * Idempotent on the backend (``get_identity`` lazy-creates the
   * cert + key on first call but never rotates), so re-firing on
   * dialog re-open or after a rotate just refreshes the local
   * state. Tracks failure separately from the null-while-loading
   * state so the UI can render an explicit error message rather
   * than spinning forever.
   *
   * **Cross-tab gap**: a rotation triggered from another tab
   * won't refresh this tab's card until the user closes and
   * reopens Settings. 3c2c will set up the
   * ``remote_build_identity_rotated`` event subscription to
   * cover that case; binding-mismatch alerts in 3c2c MUST
   * fire while the user sits on the page (so the events
   * plumbing is mandatory there), and the identity-refresh
   * piggybacks on the same wiring.
   */
  private async _loadRemoteBuildIdentity(): Promise<void> {
    if (this._api === undefined) {
      return;
    }
    try {
      this._remoteBuildIdentity = await this._api.getRemoteBuildIdentity();
      this._remoteBuildIdentityLoadFailed = false;
    } catch (err) {
      console.warn("Could not load remote-build identity:", err);
      this._remoteBuildIdentityLoadFailed = true;
    }
  }

  private _onRotateRequest() {
    // Open the shared ``<esphome-confirm-dialog>`` rather than
    // rotating immediately. Rotation is a security-sensitive
    // action that invalidates every paired offloader's pin;
    // a single misclick shouldn't trigger that cascade. The
    // confirm dialog (shared component, destructive style)
    // spells out the consequence so the user has to
    // acknowledge it; the rotate body lives in
    // ``_onRotateConfirm`` and is wired via the dialog's
    // ``@confirm`` event.
    this._rotateConfirmDialog?.open();
  }

  /**
   * Localised + ``richColors``-styled toast shorthand.
   *
   * The richColors-styled toast pattern repeats six times in
   * the rotate / copy / mismatch flows; centralising it here
   * keeps each call site to a single line and a single point
   * of change for the styling contract.
   *
   * TODO: pre-3c2 callers in this file (the manual-host
   * mutation paths, the master-toggle revert) still spell out
   * the long form inline — they should be migrated to this
   * helper as a separate cleanup PR. Doing it here would
   * balloon the 3c2b diff for no behavior change. Risk if not
   * migrated: the ``richColors: true`` styling contract
   * silently drifts between call sites over time.
   */
  private _toast(level: "success" | "warning" | "error", key: string) {
    toast[level](this._localize(key), { richColors: true });
  }

  private async _onRotateConfirm() {
    if (this._api === undefined || this._remoteBuildRotateInFlight) {
      return;
    }
    // Optimistic-update would be wrong here: a rotate hands
    // back a wholly new pin that the frontend can't predict
    // (it's the SHA-256 of the freshly-generated SPKI), so
    // there's nothing we can pre-fill. Just gate the button
    // on ``_remoteBuildRotateInFlight`` and toast the result.
    this._remoteBuildRotateInFlight = true;
    try {
      this._remoteBuildIdentity = await this._api.rotateRemoteBuildIdentity();
      this._remoteBuildIdentityLoadFailed = false;
      if (this._remoteBuildIdentity.listener_bound) {
        this._toast("success", "settings.remote_build_rotate_success");
      } else {
        // Listener didn't come back up after the rebuild.
        // Backend's ``reload_remote_build_identity`` is
        // fail-soft; the operator should check logs. Surface
        // this distinct from generic failure so they don't
        // think the rotation didn't happen.
        this._toast("warning", "settings.remote_build_rotate_listener_down");
      }
    } catch (err) {
      if (err instanceof APIError && err.errorCode === ErrorCode.ALREADY_EXISTS) {
        // 3c1 single-flight: another rotation is in progress
        // (possibly from another tab). The button is disabled
        // while ``_remoteBuildRotateInFlight`` is true on this
        // tab, but not the other tab's. Toast distinct from
        // generic failure so the user knows to wait, not retry.
        this._toast("warning", "settings.remote_build_rotate_already_in_progress");
      } else {
        this._toast("error", "settings.remote_build_rotate_failed");
      }
    } finally {
      this._remoteBuildRotateInFlight = false;
    }
  }

  private async _onCopyPin() {
    // Defensive: refuse to "successfully" copy an empty value.
    // A stale ``_remoteBuildIdentity`` or a state-glitch where
    // ``pin_sha256`` is briefly empty would otherwise produce
    // a "Copied!" toast while putting nothing on the clipboard
    // — exactly the failure mode that's confusing to debug
    // because the toast lies. If the pin is missing, surface
    // the same error toast as a true copy failure so the user
    // knows to refresh.
    const pin = this._remoteBuildIdentity?.pin_sha256;
    if (!pin) {
      this._toast("warning", "settings.remote_build_pin_copy_failed");
      return;
    }
    // Copy the unformatted (no-spaces) pin so a paste into a
    // compare-with-receiver field doesn't pick up the OOB
    // display formatting. The display formatting is for the
    // human's eyes; programmatic comparison wants the raw form.
    //
    // Goes through ``copyToClipboard`` (rather than
    // ``navigator.clipboard.writeText`` directly) because the
    // modern Clipboard API requires a "secure context" — the
    // dashboard is frequently reached on HTTP at non-localhost
    // LAN IPs (HA-addon direct port, container deployments)
    // where ``navigator.clipboard`` is undefined or throws
    // ``NotAllowedError``. The helper falls back to a hidden
    // ``<span>`` + Selection API + ``execCommand("copy")`` in
    // those contexts (see ``util/copy-to-clipboard.ts``).
    if (await copyToClipboard(pin)) {
      this._toast("success", "settings.remote_build_pin_copied");
    } else {
      // Surface the failure rather than silently no-op; the
      // user clicked a button and deserves feedback. They can
      // still read the pin off the card and copy it manually.
      this._toast("warning", "settings.remote_build_pin_copy_failed");
    }
  }

  static styles = [
    espHomeStyles,
    css`
      wa-dialog {
        --width: min(800px, 95vw);
      }

      wa-dialog::part(header) {
        background: var(--esphome-primary);
        padding: 0 var(--wa-space-m);
        height: 40px;
        box-sizing: border-box;
      }

      wa-dialog::part(title) {
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      wa-dialog::part(close-button__base) {
        background: transparent;
        border: none;
        box-shadow: none;
        padding: 0;
        min-width: unset;
        min-height: unset;
        color: var(--esphome-on-primary);
        cursor: pointer;
      }

      wa-dialog::part(footer) {
        display: none;
      }

      wa-dialog::part(body) {
        padding: 0;
      }

      .layout {
        display: flex;
        height: min(500px, 70vh);
      }

      .sidebar {
        width: 220px;
        flex-shrink: 0;
        background: var(--wa-color-surface-default);
        border-right: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        padding: var(--wa-space-m) var(--wa-space-xs);
        overflow-y: auto;
      }

      .nav {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .nav-item {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
        padding: 8px var(--wa-space-s);
        border: none;
        background: transparent;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-s);
        font-family: inherit;
        color: var(--wa-color-text-normal);
        cursor: pointer;
        text-align: left;
        transition:
          background 0.12s,
          color 0.12s,
          text-shadow 0.12s;
      }

      .nav-item:hover,
      .nav-item--active {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
        /* Fake bold via text-shadow so the layout doesn't reflow on hover.
           Changing real font-weight widens the text, the cursor falls off
           the element, the hover drops, and you get the flicker. */
        text-shadow:
          0.4px 0 0 currentColor,
          -0.4px 0 0 currentColor;
      }

      .nav-item:hover wa-icon,
      .nav-item--active wa-icon {
        color: var(--wa-color-text-normal);
      }

      .nav-item wa-icon {
        font-size: 18px;
        color: var(--wa-color-text-quiet);
        transition: color 0.12s;
      }

      .content {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
        overflow: hidden;
      }

      .content-body {
        flex: 1;
        padding: 0 var(--wa-space-l);
        padding-bottom: var(--wa-space-l);
        overflow-y: auto;
      }

      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-m);
        padding: var(--wa-space-m) 0;
        border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .row:last-child {
        border-bottom: none;
      }

      .row-label {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .row-title {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .row-desc {
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
      }

      wa-select {
        min-width: 180px;
      }

      .toggle {
        position: relative;
        width: 40px;
        height: 22px;
        border: none;
        border-radius: 11px;
        background: var(--wa-color-surface-border);
        cursor: pointer;
        transition: background 0.15s;
        padding: 0;
        flex-shrink: 0;
      }

      .toggle[aria-checked="true"] {
        background: var(--esphome-primary);
      }

      .toggle::after {
        content: "";
        position: absolute;
        top: 3px;
        left: 3px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: white;
        transition: transform 0.15s;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      }

      .toggle[aria-checked="true"]::after {
        transform: translateX(18px);
      }

      /* Phase 2b: Remote builder section */

      .phase-banner {
        margin: 0 var(--wa-space-m) var(--wa-space-m);
        padding: var(--wa-space-s) var(--wa-space-m);
        border-radius: var(--wa-border-radius-s);
        background: var(--wa-color-warning-fill-quiet, #fff7e0);
        color: var(--wa-color-warning-text-quiet, #6b4f00);
        border-left: 3px solid
          var(--wa-color-warning-border-loud, #f0b400);
        font-size: var(--wa-font-size-s);
      }

      .role-section-heading {
        font-size: var(--wa-font-size-l);
        font-weight: var(--wa-font-weight-semibold);
        margin: var(--wa-space-l) 0 var(--wa-space-2xs);
        padding: 0 var(--wa-space-m);
      }

      .role-section-heading:first-of-type {
        margin-top: 0;
      }

      .role-section-desc {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        margin: 0 0 var(--wa-space-s);
        padding: 0 var(--wa-space-m);
      }

      .section-heading {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-semibold);
        color: var(--wa-color-text-quiet);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin: var(--wa-space-l) 0 var(--wa-space-xs);
        padding: 0 var(--wa-space-m);
      }

      .peer-row .row-title {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
      }

      .peer-badge {
        display: inline-block;
        padding: 1px 6px;
        border-radius: 4px;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-semibold);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .peer-badge--mdns {
        background: var(--wa-color-surface-border);
        color: var(--wa-color-text-quiet);
      }

      .peer-badge--manual {
        background: var(--esphome-primary-soft, var(--wa-color-surface-border));
        color: var(--esphome-primary);
      }

      .peer-remove {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border: none;
        border-radius: var(--wa-border-radius-s);
        background: transparent;
        color: var(--wa-color-text-quiet);
        cursor: pointer;
        flex-shrink: 0;
      }

      .peer-remove:hover,
      .peer-remove:focus-visible {
        background: var(--wa-color-surface-border);
        color: var(--wa-color-text);
      }

      .manual-host-form {
        display: flex;
        gap: var(--wa-space-s);
        padding: var(--wa-space-xs) var(--wa-space-m) var(--wa-space-m);
        align-items: center;
      }

      .manual-host-input {
        flex: 1 1 auto;
        min-width: 0;
        height: 36px;
        padding: 0 var(--wa-space-s);
        border: 1px solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-s);
        background: var(--wa-color-surface-default);
        color: var(--wa-color-text);
        font: inherit;
      }

      .manual-host-port {
        flex: 0 0 100px;
      }

      .manual-host-input:focus {
        outline: 2px solid var(--esphome-primary);
        outline-offset: -1px;
      }

      .manual-host-add {
        height: 36px;
        padding: 0 var(--wa-space-m);
        border: none;
        border-radius: var(--wa-border-radius-s);
        background: var(--esphome-primary);
        color: white;
        font-weight: var(--wa-font-weight-semibold);
        cursor: pointer;
        flex-shrink: 0;
      }

      .manual-host-add:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .build-host-card {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-s);
        padding: var(--wa-space-m);
        margin: 0 var(--wa-space-m) var(--wa-space-m) var(--wa-space-m);
        background: var(--wa-color-surface-default);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
      }

      .build-host-row {
        display: flex;
        align-items: baseline;
        gap: var(--wa-space-s);
        flex-wrap: wrap;
      }

      .build-host-label {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-semibold);
        color: var(--wa-color-text-quiet);
        min-width: 110px;
      }

      .build-host-pin {
        font-family: var(--wa-font-family-mono, monospace);
        font-size: var(--wa-font-size-xs);
        word-break: break-all;
        flex: 1;
      }

      .build-host-dashboard-id {
        font-family: var(--wa-font-family-mono, monospace);
        font-size: var(--wa-font-size-s);
        word-break: break-all;
        flex: 1;
      }

      .build-host-versions {
        display: flex;
        gap: var(--wa-space-l);
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
      }

      .build-host-versions code {
        font-family: var(--wa-font-family-mono, monospace);
        color: var(--wa-color-text-normal);
        margin-left: var(--wa-space-xs);
      }

      .build-host-actions {
        display: flex;
        gap: var(--wa-space-s);
        align-items: center;
        flex-wrap: wrap;
      }

      .build-host-copy,
      .build-host-rotate {
        padding: 6px var(--wa-space-m);
        background: var(--wa-color-surface-raised);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-s);
        color: var(--wa-color-text-normal);
        font-family: inherit;
        font-size: var(--wa-font-size-s);
        cursor: pointer;
      }

      .build-host-rotate {
        color: var(--wa-color-danger-on-quiet, #b00020);
        border-color: var(--wa-color-danger-on-quiet, #b00020);
      }

      .build-host-rotate:disabled,
      .build-host-copy:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .build-host-listener-badge {
        display: inline-flex;
        align-items: center;
        padding: 2px var(--wa-space-s);
        border-radius: var(--wa-border-radius-pill, 999px);
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-semibold);
      }

      .build-host-listener-up {
        background: var(--wa-color-success-quiet, #d6f5dd);
        color: var(--wa-color-success-on-quiet, #036a1c);
      }

      .build-host-listener-down {
        background: var(--wa-color-warning-quiet, #fff3cd);
        color: var(--wa-color-warning-on-quiet, #8a6d3b);
      }

      @media (max-width: 700px) {
        .layout {
          flex-direction: column;
          height: auto;
        }
        .sidebar {
          width: auto;
          border-right: none;
          border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        }
        .nav {
          flex-direction: row;
          flex-wrap: wrap;
        }
      }
    `,
  ];

  protected render() {
    const current = SECTIONS.find((s) => s.id === this._section) ?? SECTIONS[0];

    return html`
      <wa-dialog
        light-dismiss
        label="${this._localize("settings.title")} - ${this._localize(current.labelKey)}"
      >
        <div class="layout">
          <aside class="sidebar">
            <nav class="nav">
              ${SECTIONS.map(
                (s) => html`
                  <button
                    class="nav-item ${s.id === this._section ? "nav-item--active" : ""}"
                    @click=${() => this._selectSection(s.id)}
                  >
                    <wa-icon library="mdi" name=${s.icon}></wa-icon>
                    <span>${this._localize(s.labelKey)}</span>
                  </button>
                `
              )}
            </nav>
          </aside>
          <main class="content">
            <div class="content-body">${this._renderSection()}</div>
          </main>
        </div>
      </wa-dialog>
    `;
  }

  private _renderSection() {
    switch (this._section) {
      case "appearance":
        return this._renderAppearance();
      case "language":
        return this._renderLanguage();
      case "editor":
        return this._renderEditor();
      case "remote_build":
        return this._renderRemoteBuild();
    }
  }

  private _renderAppearance() {
    return html`
      <div class="row">
        <div class="row-label">
          <span class="row-title">${this._localize("layout.theme")}</span>
          <span class="row-desc">${this._localize("settings.theme_desc")}</span>
        </div>
        <wa-select value=${this._theme} @change=${this._onThemeChange}>
          <wa-option value="light">${this._localize("layout.theme_light")}</wa-option>
          <wa-option value="dark">${this._localize("layout.theme_dark")}</wa-option>
          <wa-option value="system">${this._localize("layout.theme_system")}</wa-option>
        </wa-select>
      </div>
    `;
  }

  private _renderLanguage() {
    return html`
      <div class="row">
        <div class="row-label">
          <span class="row-title">${this._localize("settings.language")}</span>
          <span class="row-desc">${this._localize("settings.language_desc")}</span>
        </div>
        <wa-select value=${this._language} @change=${this._onLanguageChange}>
          ${LANGUAGES.map(
            (l) => html`
              <wa-option value=${l.value}>${this._localize(l.labelKey)}</wa-option>
            `
          )}
        </wa-select>
      </div>
    `;
  }

  private _renderEditor() {
    // ``aria-checked`` is the string-attribute form
    // (``aria-checked=${value}``). Lit's ``?aria-checked=...``
    // boolean binding would omit the attribute entirely on
    // ``false``, breaking both the ``[aria-checked="false"]`` CSS
    // state and the screen-reader announcement. ``aria-labelledby``
    // points at the row title so the toggle has an accessible
    // name; without it screen readers announce only "switch,
    // checked" with no context.
    return html`
      <div class="row">
        <div class="row-label">
          <span id="yaml-diff-title" class="row-title">
            ${this._localize("settings.show_yaml_diff_button")}
          </span>
          <span class="row-desc">
            ${this._localize("settings.show_yaml_diff_button_desc")}
          </span>
        </div>
        <button
          class="toggle"
          role="switch"
          aria-labelledby="yaml-diff-title"
          aria-checked=${this._yamlDiffButton}
          @click=${this._onToggleDiff}
        ></button>
      </div>
    `;
  }

  private _renderRemoteBuild() {
    // Two distinct roles live in this section, so split them
    // visually with explicit subheadings + descriptions to make
    // the direction unambiguous: are we letting other dashboards
    // build for us, or are we offloading our builds to them?
    //
    // Both halves are scaffolding right now; the active phases
    // (1, 2, 2b) only persist state. The "not implemented yet"
    // banners are deliberate. Without them the UI looks
    // functional but silently does nothing on click, which is
    // worse than telling the user the feature isn't ready. The
    // banners come down as phases 3-5 land.
    return html`
      <div class="phase-banner" role="status">
        ${this._localize("settings.remote_build_unimplemented_banner")}
      </div>

      <div class="role-section-heading">
        ${this._localize("settings.remote_build_role_receive")}
      </div>
      <div class="role-section-desc">
        ${this._localize("settings.remote_build_role_receive_desc")}
      </div>
      <div class="row">
        <div class="row-label">
          <span id="remote-build-enable-title" class="row-title">
            ${this._localize("settings.remote_build_enable")}
          </span>
          <span class="row-desc">
            ${this._localize("settings.remote_build_enable_desc")}
          </span>
        </div>
        <button
          class="toggle"
          role="switch"
          aria-labelledby="remote-build-enable-title"
          aria-checked=${this._remoteBuildEnabled}
          @click=${this._onToggleRemoteBuild}
        ></button>
      </div>

      <div class="section-heading">
        ${this._localize("settings.remote_build_build_host")}
      </div>
      <div class="role-section-desc">
        ${this._localize("settings.remote_build_build_host_desc")}
      </div>
      ${this._renderBuildHostCard()}

      <div class="role-section-heading">
        ${this._localize("settings.remote_build_role_offload")}
      </div>
      <div class="role-section-desc">
        ${this._localize("settings.remote_build_role_offload_desc")}
      </div>

      <div class="section-heading">
        ${this._localize("settings.remote_build_known_dashboards")}
      </div>
      ${this._renderRemoteBuildPeers()}

      <div class="section-heading">
        ${this._localize("settings.remote_build_add_manual")}
      </div>
      <div class="row">
        <div class="row-label">
          <span class="row-desc">
            ${this._localize("settings.remote_build_add_manual_desc")}
          </span>
        </div>
      </div>
      <form class="manual-host-form" @submit=${this._onAddManualHost}>
        <input
          class="manual-host-input"
          type="text"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          required
          placeholder=${this._localize(
            "settings.remote_build_add_manual_host_placeholder"
          )}
          aria-label=${this._localize(
            "settings.remote_build_add_manual_host_label"
          )}
          .value=${this._remoteBuildHostInput}
          @input=${(e: InputEvent) => {
            this._remoteBuildHostInput = (e.target as HTMLInputElement).value;
          }}
        />
        <input
          class="manual-host-input manual-host-port"
          type="number"
          min="1"
          max="65535"
          required
          aria-label=${this._localize(
            "settings.remote_build_add_manual_port_label"
          )}
          .value=${this._remoteBuildPortInput}
          @input=${(e: InputEvent) => {
            this._remoteBuildPortInput = (e.target as HTMLInputElement).value;
          }}
        />
        <button
          class="manual-host-add"
          type="submit"
          ?disabled=${this._remoteBuildAddInFlight}
        >
          ${this._localize("settings.remote_build_add_manual_submit")}
        </button>
      </form>
    `;
  }

  private _renderBuildHostCard() {
    if (this._remoteBuildIdentityLoadFailed) {
      return html`
        <div class="row" role="alert">
          <div class="row-label">
            <span class="row-desc">
              ${this._localize("settings.remote_build_identity_load_failed")}
            </span>
          </div>
        </div>
      `;
    }
    if (this._remoteBuildIdentity === null) {
      return html`
        <div class="row" role="status">
          <div class="row-label">
            <span class="row-desc">
              ${this._localize("settings.remote_build_identity_loading")}
            </span>
          </div>
        </div>
      `;
    }
    const identity = this._remoteBuildIdentity;
    const formattedPin = formatPinSha256(identity.pin_sha256);
    return html`
      <div class="build-host-card">
        <div class="build-host-row">
          <span class="build-host-label">
            ${this._localize("settings.remote_build_pin_label")}
          </span>
          <code class="build-host-pin">${formattedPin}</code>
        </div>
        <div class="build-host-actions">
          <button class="build-host-copy" type="button" @click=${this._onCopyPin}>
            ${this._localize("settings.remote_build_pin_copy")}
          </button>
          <span
            class=${`build-host-listener-badge build-host-listener-${
              identity.listener_bound ? "up" : "down"
            }`}
            role="status"
          >
            ${identity.listener_bound
              ? this._localize("settings.remote_build_listener_up")
              : this._localize("settings.remote_build_listener_down")}
          </span>
        </div>
        <div class="build-host-row">
          <span class="build-host-label">
            ${this._localize("settings.remote_build_dashboard_id_label")}
          </span>
          <code class="build-host-dashboard-id">${identity.dashboard_id}</code>
        </div>
        <div class="build-host-row build-host-versions">
          <span>
            ${this._localize("settings.remote_build_server_version_label")}
            <code>${identity.server_version}</code>
          </span>
          <span>
            ${this._localize("settings.remote_build_esphome_version_label")}
            <code>${identity.esphome_version}</code>
          </span>
        </div>
        <div class="build-host-actions">
          <button
            class="build-host-rotate"
            type="button"
            ?disabled=${this._remoteBuildRotateInFlight}
            @click=${this._onRotateRequest}
          >
            ${this._remoteBuildRotateInFlight
              ? this._localize("settings.remote_build_rotate_in_progress")
              : this._localize("settings.remote_build_rotate")}
          </button>
        </div>
      </div>
      <esphome-confirm-dialog
        id="rotate-confirm"
        destructive
        heading=${this._localize("settings.remote_build_rotate_confirm_title")}
        message=${this._localize("settings.remote_build_rotate_confirm_body")}
        confirm-label=${this._localize(
          "settings.remote_build_rotate_confirm_confirm"
        )}
        @confirm=${this._onRotateConfirm}
      ></esphome-confirm-dialog>
    `;
  }

  private _renderRemoteBuildPeers() {
    if (this._remoteBuildPeers === null) {
      return html`
        <div class="row" role="status">
          <div class="row-label">
            <span class="row-desc">
              ${this._localize("settings.remote_build_peers_loading")}
            </span>
          </div>
        </div>
      `;
    }
    if (this._remoteBuildPeers.length === 0) {
      return html`
        <div class="row" role="status">
          <div class="row-label">
            <span class="row-desc">
              ${this._localize("settings.remote_build_peers_empty")}
            </span>
          </div>
        </div>
      `;
    }
    return this._remoteBuildPeers.map((peer) => this._renderPeerRow(peer));
  }

  private _renderPeerRow(peer: RemoteBuildPeer) {
    const isManual = peer.source === "manual";
    const versionLine = peer.esphome_version
      ? this._localize("settings.remote_build_peer_version_line", {
          esphome: peer.esphome_version,
        })
      : nothing;
    return html`
      <div class="row peer-row">
        <div class="row-label">
          <span class="row-title">
            ${peer.name}
            <span class="peer-badge peer-badge--${peer.source}">
              ${this._localize(
                isManual
                  ? "settings.remote_build_peer_source_manual"
                  : "settings.remote_build_peer_source_mdns"
              )}
            </span>
          </span>
          <span class="row-desc">
            ${peer.hostname}:${peer.port} ${versionLine}
          </span>
        </div>
        ${isManual
          ? html`
              <button
                class="peer-remove"
                aria-label=${this._localize(
                  "settings.remote_build_peer_remove",
                  { hostname: peer.hostname }
                )}
                @click=${() => this._onRemoveManualHost(peer)}
              >
                <wa-icon library="mdi" name="close"></wa-icon>
              </button>
            `
          : nothing}
      </div>
    `;
  }

  private _onThemeChange(e: Event) {
    const theme = (e.target as HTMLSelectElement).value;
    this._theme = theme;
    this.dispatchEvent(
      new CustomEvent("set-theme", {
        detail: theme,
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onLanguageChange(e: Event) {
    const lang = (e.target as HTMLSelectElement).value as LanguageChoice;
    this._language = lang;
    this.dispatchEvent(
      new CustomEvent("set-language", {
        detail: lang,
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onToggleDiff() {
    this.dispatchEvent(
      new CustomEvent("set-yaml-diff-button", {
        detail: !this._yamlDiffButton,
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onToggleRemoteBuild() {
    this.dispatchEvent(
      new CustomEvent("set-remote-build-enabled", {
        detail: !this._remoteBuildEnabled,
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Run an add/remove mutation against the API and refresh the
   * peer list on success.
   *
   * Returns ``true`` when the *mutation* landed cleanly, which is
   * the only signal callers chain "clear the input" / "close the
   * row" UI steps off — independent of whether the post-mutation
   * peer-list refresh succeeded. If the mutation succeeds but the
   * refresh fails, the prior list stays visible (not clobbered to
   * ``[]``) and a separate "saved but couldn't refresh" toast goes
   * up so the user knows the list might be stale. Treating a
   * refresh failure as a mutation failure used to mean a
   * successful add looked like it had failed (input cleared, list
   * empty); the split here is what fixes that.
   *
   * On mutation failure, surfaces the toast message returned by
   * ``classifyError`` and returns ``false``. No-op when the API
   * context isn't wired (returns ``false``).
   */
  private async _runManualHostMutation(
    call: (api: ESPHomeAPI) => Promise<unknown>,
    classifyError: (err: unknown) => string,
  ): Promise<boolean> {
    if (this._api === undefined) {
      return false;
    }
    try {
      await call(this._api);
    } catch (err) {
      toast.error(this._localize(classifyError(err)), { richColors: true });
      return false;
    }
    const refreshed = await this._loadRemoteBuildPeers();
    if (!refreshed) {
      toast.warning(
        this._localize("settings.remote_build_refresh_failed"),
        { richColors: true },
      );
    }
    return true;
  }

  private async _onAddManualHost(e: Event) {
    e.preventDefault();
    if (this._remoteBuildAddInFlight) {
      return;
    }
    const hostname = this._remoteBuildHostInput.trim();
    const port = Number.parseInt(this._remoteBuildPortInput, 10);
    if (!hostname || !Number.isFinite(port) || port < 1 || port > 65535) {
      // Browser-side guard against the "user clicks Add with bad
      // input before the server validates" path. Server-side
      // validation in ``add_manual_host`` is still authoritative.
      toast.error(
        this._localize("settings.remote_build_add_manual_invalid"),
        { richColors: true }
      );
      return;
    }
    this._remoteBuildAddInFlight = true;
    const ok = await this._runManualHostMutation(
      (api) => api.addRemoteBuildManualHost({ hostname, port }),
      (err) => {
        // The backend raises ``ALREADY_EXISTS`` for duplicates so
        // we can surface that distinct from a generic failure
        // ("this peer is already in your list" rather than a
        // vague "couldn't save") without string-matching the
        // details field.
        if (err instanceof APIError && err.errorCode === ErrorCode.ALREADY_EXISTS) {
          return "settings.remote_build_add_manual_duplicate";
        }
        return "settings.remote_build_add_manual_failed";
      }
    );
    if (ok) {
      this._remoteBuildHostInput = "";
    }
    this._remoteBuildAddInFlight = false;
  }

  private _onRemoveManualHost(peer: RemoteBuildPeer) {
    return this._runManualHostMutation(
      (api) =>
        api.removeRemoteBuildManualHost({
          hostname: peer.hostname,
          port: peer.port,
        }),
      () => "settings.remote_build_remove_manual_failed"
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-settings-dialog": ESPHomeSettingsDialog;
  }
}
