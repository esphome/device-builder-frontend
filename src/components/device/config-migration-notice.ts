/**
 * One-click nudge to bring a config up to date when it uses options
 * ESPHome has renamed or replaced. Detection is a dry-run of
 * ``editor/migrate_config`` — the backend owns every rule, so a new
 * upstream rename needs no frontend change; the reply's ``changes``
 * are what the banner lists. It runs once per editor load (per
 * configuration) — users don't author fresh deprecated options, and
 * one typed mid-session waits for the next load — then re-checks
 * (debounced; each check is a WS round-trip) only while the nudge is
 * visible so a completed migration clears it. The CTA asks the page
 * to run the same command on the draft; Preview shows the dry run's
 * result as a diff first. The dashboard's per-device
 * ``migration_available`` flag answers the same question for the
 * saved main file; this notice sees the unsaved draft.
 */
import { consume } from "@lit/context";
import { mdiClose, mdiUpdate } from "@mdi/js";
import { css, html, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { MigrationChange } from "../../api/types/editor.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { fireEvent } from "../../util/fire-event.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { applyYamlDiff } from "./automation-editor/serialise.js";
import { describeMigrationChange } from "./config-migration-copy.js";
import type { ESPHomeConfigMigrationPreviewDialog } from "./config-migration-preview-dialog.js";
import { renderNoticeBanner } from "./notice-banner.js";
import { noticeBannerStyles, noticeCloseStyles } from "./notice-banner.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./config-migration-preview-dialog.js";

registerMdiIcons({ update: mdiUpdate, close: mdiClose });

const RECHECK_DEBOUNCE_MS = 750;

/** Changes listed in the banner before the rest collapse into "and N more". */
const MAX_LISTED_CHANGES = 10;

/** A dry run that found something: the draft it saw, that draft migrated, and the rules. */
interface Detection {
  yaml: string;
  migrated: string;
  changes: MigrationChange[];
}

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

  /** The last dry run's result; ``null`` while the draft is clean. */
  @state() private _detection: Detection | null = null;

  @state() private _dismissed = false;

  @query("esphome-config-migration-preview-dialog")
  private _preview?: ESPHomeConfigMigrationPreviewDialog;

  /** Configuration the load-time detection ran for. */
  private _detectedFor: string | null = null;

  private _recheckTimer?: ReturnType<typeof setTimeout>;

  protected willUpdate(changed: PropertyValues) {
    if (this.yaml && this._api && this._detectedFor !== this.configuration) {
      this._detectedFor = this.configuration;
      this._dismissed = false;
      this._detection = null;
      this._cancelRecheck();
      void this._detect();
    } else if (
      changed.has("yaml") &&
      (this._detection !== null || this._recheckTimer !== undefined) &&
      !this._dismissed
    ) {
      // Re-check only while the nudge is live (or a load-path re-arm is
      // pending — typing defers it) so a completed migration clears it;
      // anything typed later waits for the next load.
      this._armRecheck();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._cancelRecheck();
  }

  static styles = [
    noticeBannerStyles,
    noticeCloseStyles,
    css`
      :host {
        display: block;
        /* Migration identity color — matches the dashboard dot and badge. */
        --notice-accent: var(--esphome-migration);
      }
      :host([hidden]) {
        display: none;
      }
      /* A spelling the installed ESPHome already rejects is an error, not a nudge. */
      .required {
        --notice-accent: var(--esphome-error);
      }
      ul {
        margin: 0;
        padding-left: 1.2em;
      }
      code {
        font-family: var(--wa-font-family-code);
        font-size: var(--wa-font-size-xs);
      }
    `,
  ];

  protected render() {
    const detection = this._detection;
    if (detection === null || this._dismissed) return nothing;
    const required = detection.changes.some((change) => change.required);
    return html`
      <div class=${required ? "required" : nothing}>
        ${renderNoticeBanner({
          icon: "update",
          text: this._renderChanges(detection.changes),
          ctaLabel: this._localize("device.config_migration_migrate"),
          onCta: () => fireEvent(this, "request-migrate-config"),
          // A re-check is pending once the draft moved on; the preview would
          // show the previous dry run, so hold it until the next lands.
          secondary:
            detection.yaml === this.yaml
              ? {
                  label: this._localize("device.config_migration_preview"),
                  onClick: () => this._preview?.open(),
                }
              : undefined,
          dismissLabel: this._localize("device.config_migration_dismiss"),
          onDismiss: () => {
            this._dismissed = true;
            this._cancelRecheck();
          },
        })}
      </div>
      <esphome-config-migration-preview-dialog
        .configuration=${this.configuration}
        .oldValue=${detection.yaml}
        .newValue=${detection.migrated}
      ></esphome-config-migration-preview-dialog>
    `;
  }

  private _renderChanges(changes: MigrationChange[]) {
    if (changes.length === 0) return this._localize("device.config_migration_notice");
    const listed = changes.slice(0, MAX_LISTED_CHANGES);
    const more = changes.length - listed.length;
    return html`
      <ul>
        ${listed.map((change) => html`<li>${describeMigrationChange(this._localize, change)}</li>`)}
        ${
          more > 0
            ? html`<li>
                ${this._localize("device.editor_invalid_more", { count: more })}
              </li>`
            : nothing
        }
      </ul>
    `;
  }

  private _armRecheck(): void {
    clearTimeout(this._recheckTimer);
    this._recheckTimer = setTimeout(() => {
      this._recheckTimer = undefined;
      void this._detect();
    }, RECHECK_DEBOUNCE_MS);
  }

  private _cancelRecheck(): void {
    clearTimeout(this._recheckTimer);
    this._recheckTimer = undefined;
  }

  /** Dry-run migrate on the draft; a stale resolve (buffer or config moved on) is discarded. */
  private async _detect(): Promise<void> {
    const { configuration, yaml, _api: api } = this;
    if (!api) return;
    try {
      const { yaml_diff, changes } = await api.migrateConfig(yaml);
      if (configuration !== this.configuration) return;
      if (yaml !== this.yaml) {
        // Only the buffer moved on — re-arm instead of dropping, so a
        // keystroke inside the round-trip can't lose the load's one
        // detection shot.
        if (!this._dismissed && this.isConnected) this._armRecheck();
        return;
      }
      this._detection =
        yaml_diff === null
          ? null
          : {
              yaml,
              migrated: applyYamlDiff(yaml, yaml_diff),
              // Required changes first, so one never hides behind "and N more".
              changes: [...changes].sort(
                (a, b) => Number(b.required) - Number(a.required)
              ),
            };
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
