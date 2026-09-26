import type { TemplateResult } from "lit";
import type { PortFamily } from "../../platforms/port-family.js";

/**
 * One device family on web.esphome.io: its mode in the URL and the header,
 * the connect card the dashboard shows for it, and the USB ids that point a
 * picked or plugged-in port at it. ``registry.ts`` lists them; the header, the
 * dashboard, the mode URL and the flow-switch toast read everything from
 * there, so a new family is a new ``platforms/<name>/`` plus one entry.
 */
export interface WebPlatform<Mode extends string = string> {
  /** The URL flag (a bare ``?pico``); the default mode has none. */
  readonly mode: Mode;
  /** Header logo under ``/static/logo/``. */
  readonly logo: string;
  readonly labelKey: string;
  /** The intro copy under the connect card. */
  readonly introKey: string;
  renderCard(): TemplateResult;
  /** Shows the legacy ``?dashboard_logs`` / install / wizard hint. */
  readonly dashboardHints?: boolean;
  /** Offer switching to this family when a picked or plugged-in port belongs to it. */
  readonly flowSwitch?: FlowSwitch;
}

export interface FlowSwitch {
  /** The family a port's USB ids must name (``portFamily``) to be this one's. */
  readonly family: PortFamily;
  /** The toast's message and its switch button. */
  readonly messageKey: string;
  readonly actionKey: string;
}
