/**
 * One-click nudge to bring a config up to date when it uses options
 * ESPHome has renamed or replaced. Detection is a dry-run of
 * ``editor/migrate_config`` — the backend owns every rule, so a new
 * upstream rename needs no frontend change. It runs once per editor
 * load (per configuration) — users don't author fresh deprecated
 * options, and one typed mid-session waits for the next load — then
 * re-checks (debounced; each check is a WS round-trip) only while the
 * nudge is visible so a completed migration clears it. The CTA asks
 * the page to run the same command on the draft.
 */
import { consume } from "@lit/context";
import { mdiClose, mdiUpdate } from "@mdi/js";
import { css, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { fireEvent } from "../../util/fire-event.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { renderNoticeBanner } from "./notice-banner.js";
import { noticeBannerStyles, noticeCloseStyles } from "./notice-banner.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ update: mdiUpdate, close: mdiClose });

const RECHECK_DEBOUNCE_MS = 750;

@customElement("esphome-config-migration-notice")
export class ESPHomeConfigMigrationNotice extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  // subscribe so a late-arriving context kicks the load-time detection.
  @consume({ context: apiContext, subscribe: true })
  @state()
  private _api?: ESPHomeAPI;

  @property() configuration = "";

  /** The page's draft buffer. */
  @property({ attribute: false }) yaml = "";

  @state() private _needed = false;

  @state() private _dismissed = false;

  /** Configuration the load-time detection ran for. */
  private _detectedFor: string | null = null;

  private _recheckTimer?: ReturnType<typeof setTimeout>;

  protected willUpdate(changed: PropertyValues) {
    if (this.yaml && this._api && this._detectedFor !== this.configuration) {
      this._detectedFor = this.configuration;
      this._dismissed = false;
      this._needed = false;
      clearTimeout(this._recheckTimer);
      void this._detect();
    } else if (changed.has("yaml") && this._needed && !this._dismissed) {
      // Re-check only while the nudge is live so a completed migration
      // clears it; anything typed later waits for the next load.
      clearTimeout(this._recheckTimer);
      this._recheckTimer = setTimeout(() => void this._detect(), RECHECK_DEBOUNCE_MS);
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._recheckTimer);
  }

  static styles = [
    noticeBannerStyles,
    noticeCloseStyles,
    css`
      :host {
        display: block;
      }
      :host([hidden]) {
        display: none;
      }
    `,
  ];

  protected render() {
    if (!this._needed || this._dismissed) return nothing;
    return renderNoticeBanner({
      icon: "update",
      text: this._localize("device.config_migration_notice"),
      ctaLabel: this._localize("device.config_migration_migrate"),
      onCta: () => fireEvent(this, "request-migrate-config"),
      dismissLabel: this._localize("device.config_migration_dismiss"),
      onDismiss: () => {
        this._dismissed = true;
        clearTimeout(this._recheckTimer);
      },
    });
  }

  /** Dry-run migrate on the draft; a stale resolve (buffer or config moved on) is discarded. */
  private async _detect(): Promise<void> {
    const { configuration, yaml, _api: api } = this;
    if (!api) return;
    try {
      const { yaml_diff } = await api.migrateConfig(yaml);
      if (configuration !== this.configuration || yaml !== this.yaml) return;
      this._needed = yaml_diff !== null;
    } catch (err) {
      // Keep the current verdict: hidden at load (the next load
      // retries), still shown during a re-check — a transient WS
      // failure must not clear a nudge the buffer hasn't been
      // proven clean of.
      console.warn("config-migration-notice: detection failed", err);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-config-migration-notice": ESPHomeConfigMigrationNotice;
  }
}
