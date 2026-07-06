/**
 * Inline deprecation nudge shown above a section's form when the config uses a
 * deprecated option with a losslessly derivable replacement. One config-driven
 * component covers every option in `DEPRECATED_OPTIONS`:
 *
 * - `ethernet` — flat `clk_mode: GPIO<n>_(IN|OUT)` → nested `clk: {pin, mode}`
 *   (removed upstream in ESPHome 2026.9.0).
 *
 * The rewrite is pure and draft-only: clicking the CTA emits
 * `apply-section-values` so the host splices the replacement into the unsaved
 * YAML buffer — no dialog, no backend call. Adding an option is a single
 * registry entry + its copy.
 */
import { consume } from "@lit/context";
import { mdiUpdate } from "@mdi/js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ConfigEntry } from "../../api/types/config-entries.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { isEntryVisible } from "../../util/config-validation.js";
import { notifySuccess } from "../../util/notify.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import {
  dispatchApplySectionValues,
  type ApplySectionValuesDetail,
} from "./notice-banner.js";
import { noticeBannerStyles } from "./notice-banner.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ update: mdiUpdate });

/** A deprecated option and how to rewrite it. */
export interface DeprecatedOption {
  /** Direct-child key whose presence (with a migratable value) shows the nudge. */
  key: string;
  /** `device.<copyPrefix>_*` localization keys for this option's copy. */
  copyPrefix: string;
  /** Derives the replacement `setIn` changes (`value: undefined` removes the
   *  key); `null` when the current value isn't migratable (nudge hidden). */
  migrate: (value: unknown) => { path: string[]; value: unknown }[] | null;
}

/** Deprecated flat `clk_mode: GPIO<n>_(IN|OUT)` encodes the RMII clock pin
 *  and direction in the mode string. */
const CLK_MODE_RE = /^GPIO(\d+)_(IN|OUT)$/;

/** `clk_mode` → nested `clk` with the pin in the picker's `GPIO<n>` form.
 *  Replaces any existing `clk` wholesale, mirroring upstream's precedence. */
const migrateClkMode: DeprecatedOption["migrate"] = (value) => {
  if (typeof value !== "string") return null;
  // The upstream enum is case-insensitive with spaces as underscores.
  const match = CLK_MODE_RE.exec(value.trim().toUpperCase().replace(/ /g, "_"));
  if (!match) return null;
  return [
    {
      path: ["clk"],
      value: {
        pin: `GPIO${match[1]}`,
        mode: match[2] === "IN" ? "CLK_EXT_IN" : "CLK_OUT",
      },
    },
    { path: ["clk_mode"], value: undefined },
  ];
};

/** Registry keyed by the editor `sectionKey`. */
export const DEPRECATED_OPTIONS: Record<string, DeprecatedOption[]> = {
  ethernet: [
    { key: "clk_mode", copyPrefix: "ethernet_clk_mode", migrate: migrateClkMode },
  ],
};

/** Whether this section has deprecated options to watch for. Own-property check
 *  so a top-level YAML key like `__proto__` can't resolve to an inherited
 *  (non-registry) value. */
export const isDeprecationSection = (sectionKey: string): boolean =>
  Object.prototype.hasOwnProperty.call(DEPRECATED_OPTIONS, sectionKey);

@customElement("esphome-deprecation-notice")
export class ESPHomeDeprecationNotice extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** The section whose form this notice sits above. */
  @property() sectionKey = "";

  /** The section's draft values (the host's `_values`). */
  @property({ attribute: false }) values: Record<string, unknown> = {};

  /** The section's schema entries, to honor `depends_on` gates (e.g. ethernet
   *  `clk_mode` applies only to RMII PHY types, never SPI). */
  @property({ attribute: false }) entries: ConfigEntry[] = [];

  /** Registry entries whose deprecated key is present with a migratable value. */
  private _migratable(): {
    option: DeprecatedOption;
    changes: ApplySectionValuesDetail["changes"];
  }[] {
    if (!isDeprecationSection(this.sectionKey)) return [];
    const out: {
      option: DeprecatedOption;
      changes: ApplySectionValuesDetail["changes"];
    }[] = [];
    for (const option of DEPRECATED_OPTIONS[this.sectionKey]) {
      if (!Object.prototype.hasOwnProperty.call(this.values, option.key)) continue;
      // A schema-gated deprecated key that doesn't apply to the current
      // values (wrong `type`) is a different problem than a migration.
      const entry = this.entries.find((e) => e.key === option.key);
      if (entry && !isEntryVisible(entry, this.values)) continue;
      const changes = option.migrate(this.values[option.key]);
      if (changes) out.push({ option, changes });
    }
    return out;
  }

  private _onMigrate(changes: ApplySectionValuesDetail["changes"]): void {
    dispatchApplySectionValues(this, changes);
    notifySuccess(this._localize("device.deprecation_applied"));
  }

  static styles = [espHomeStyles, noticeBannerStyles];

  protected render() {
    const migratable = this._migratable();
    if (migratable.length === 0) return nothing;
    return migratable.map(
      ({ option, changes }) => html`
        <div class="notice" role="note">
          <wa-icon library="mdi" name="update"></wa-icon>
          <div class="body">
            <p>${this._localize(`device.${option.copyPrefix}_notice`)}</p>
            <button type="button" class="cta" @click=${() => this._onMigrate(changes)}>
              ${this._localize(`device.${option.copyPrefix}_migrate`)}
            </button>
          </div>
        </div>
      `
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-deprecation-notice": ESPHomeDeprecationNotice;
  }
}
