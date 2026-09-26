import type { TemplateResult } from "lit";

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
  /** Offer switching to this family when a picked or plugged-in port is its. */
  readonly flowSwitch?: FlowSwitch;
}

export interface FlowSwitch {
  /** Whether a port's USB ids clearly belong to the family. */
  claimsPort(port: SerialPort): boolean;
  /** The toast's message and its switch button. */
  readonly messageKey: string;
  readonly actionKey: string;
}
