/**
 * One-click nudge to bring a config up to date when it uses options
 * ESPHome has renamed or replaced. Detection runs once per editor load
 * (per configuration) — users don't author fresh deprecated options,
 * and one typed mid-session waits for the next load — then re-checks
 * only while the nudge is visible so a completed migration clears it.
 * The CTA asks the page to run ``editor/migrate_config`` on the draft.
 */
import { consume } from "@lit/context";
import { mdiClose, mdiUpdate } from "@mdi/js";
import { css, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { configNeedsMigration } from "../../util/config-migrations.js";
import { fireEvent } from "../../util/fire-event.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { renderNoticeBanner } from "./notice-banner.js";
import { noticeBannerStyles, noticeCloseStyles } from "./notice-banner.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ update: mdiUpdate, close: mdiClose });

@customElement("esphome-config-migration-notice")
export class ESPHomeConfigMigrationNotice extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property() configuration = "";

  /** The page's draft buffer. */
  @property({ attribute: false }) yaml = "";

  @state() private _needed = false;

  @state() private _dismissed = false;

  /** Configuration the load-time detection ran for. */
  private _detectedFor: string | null = null;

  protected willUpdate(changed: PropertyValues) {
    if (this.yaml && this._detectedFor !== this.configuration) {
      this._detectedFor = this.configuration;
      this._dismissed = false;
      this._needed = configNeedsMigration(this.yaml);
    } else if (changed.has("yaml") && this._needed && !this._dismissed) {
      // Re-check only while the nudge is live so a completed migration
      // clears it; anything typed later waits for the next load.
      this._needed = configNeedsMigration(this.yaml);
    }
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
      },
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-config-migration-notice": ESPHomeConfigMigrationNotice;
  }
}
