import { type TemplateResult, html, nothing } from "lit";

import type { SerialPort } from "../../api/types/system.js";
import type { LocalizeFunc } from "../../common/localize.js";

/**
 * Badge column for a server serial-port row: an outlined "ESP device"
 * badge when the backend identified an Espressif native-USB port, plus
 * the filled "New" badge for a port that appeared while the picker was
 * open. Pair with `serialPortHintStyles` (src/styles/serial-port-hints.ts)
 * and `newItemHighlightStyles` in the consumer's `static styles`.
 */
export function renderSerialPortBadges(
  port: SerialPort,
  newPorts: ReadonlySet<string>,
  localize: LocalizeFunc
): TemplateResult | typeof nothing {
  const isEsp = port.hint === "esp";
  const isNew = newPorts.has(port.port);
  if (!isEsp && !isNew) return nothing;
  return html`<span class="badges">
    ${
      isEsp
        ? html`<span class="esp-badge">${localize("dashboard.serial_port_esp")}</span>`
        : nothing
    }
    ${
      isNew
        ? html`<span class="new-badge">${localize("dashboard.serial_port_new")}</span>`
        : nothing
    }
  </span>`;
}

/**
 * Beginner guidance under a multi-port list: replugging the board makes
 * the right port stand out with the "New" badge. Renders nothing when a
 * single port leaves no room for doubt.
 */
export function renderSerialPortReplugHint(
  ports: readonly SerialPort[],
  localize: LocalizeFunc
): TemplateResult | typeof nothing {
  if (ports.length < 2) return nothing;
  return html`<p class="port-hint">${localize("dashboard.serial_port_unsure_hint")}</p>`;
}
