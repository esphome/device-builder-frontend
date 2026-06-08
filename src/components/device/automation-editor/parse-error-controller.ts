import type { ReactiveController, ReactiveControllerHost } from "lit";
import { html, nothing } from "lit";

import type {
  AutomationLocation,
  AutomationTree,
  ParsedAutomation,
} from "../../../api/types/automations.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { sectionKeyFromLocation } from "./serialise.js";

/**
 * Shared read-only behaviour for the automation / script / api-action
 * editors.
 *
 * When the backend flags one automation with a parse error (unknown
 * action/condition id) its tree comes back empty; the editor must
 * render read-only and never upsert, or that empty tree would
 * overwrite the real YAML block (#1050). Each host:
 *
 *   1. Calls ``resolve(parsed, location[, kind])`` in its hydrate path
 *      and adopts the returned tree (``null`` = leave ``value`` alone).
 *   2. Early-returns ``renderPanel(localize)`` from ``render`` while
 *      ``active``.
 *   3. Bails out of its auto-apply path while ``active``.
 */
export class ParseErrorController implements ReactiveController {
  private _active = false;
  private _message = "";
  private _unsupported = false;

  constructor(private readonly _host: ReactiveControllerHost) {
    _host.addController(this);
  }

  hostConnected(): void {}

  /** True while the current automation is read-only (parse error). */
  get active(): boolean {
    return this._active;
  }

  /**
   * Match *location* against *parsed*. On a clean match, return the
   * editable tree plus the parser's resolved location (the editor
   * re-pins ``this.location`` to it so the writer round-trips against
   * the canonical form). Returns ``null`` — leave the editor's value
   * and location alone — when the match is missing or read-only. A
   * flagged automation (``error`` set, including an empty-string
   * message) records the read-only state instead. ``kind`` filters the
   * match for the single-kind editors (script / api).
   */
  resolve<L extends AutomationLocation>(
    parsed: ParsedAutomation[],
    location: L,
    kind?: L["kind"]
  ): { tree: AutomationTree; location: L } | null {
    const key = sectionKeyFromLocation(location);
    const match = parsed.find((p) => sectionKeyFromLocation(p.location) === key);
    if (!match || (kind && match.location.kind !== kind)) {
      this._set(null);
      return null;
    }
    this._set(match.error ?? null, match.unsupported ?? false);
    if (match.error != null) return null;
    // The section key encodes every location field, so a match shares
    // the caller's location kind; ``as L`` re-narrows for the writer.
    return { tree: match.automation, location: match.location as L };
  }

  /** The read-only panel rendered in place of the editable form. */
  renderPanel(localize: LocalizeFunc) {
    // A known action with no structured form is not an error — show the
    // neutral "edit in YAML" hint, no alert styling.
    if (this._unsupported) {
      return html`<div class="ae-empty-block" role="note">
        <p>${localize("device.yaml_only_section")}</p>
      </div>`;
    }
    return html`<div class="ae-empty-block" role="alert">
      <p class="ae-error">${localize("device.automation_parse_error")}</p>
      ${this._message ? html`<p>${this._message}</p>` : nothing}
    </div>`;
  }

  private _set(message: string | null, unsupported = false): void {
    const active = message != null;
    if (
      this._active === active &&
      this._message === (message ?? "") &&
      this._unsupported === unsupported
    )
      return;
    this._active = active;
    this._message = message ?? "";
    this._unsupported = unsupported;
    this._host.requestUpdate();
  }
}
