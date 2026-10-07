import { html, type TemplateResult } from "lit";
import type { ConfigEntry } from "../../../api/types/config-entries.js";
import { expanderHubAddress } from "../../../util/pin/gpio.js";
import {
  effectiveDisabled,
  fieldKeyAttr,
  type RenderCtx,
  renderFieldError,
  renderLabel,
} from "../config-entry-renderers-shared.js";
import { renderPinWiring } from "./wiring.js";

/**
 * Render an I/O-expander pin: the `provider:hub:channel` channel shown read-only
 * (an expander channel isn't a board GPIO, so the board-pin picker can't
 * represent it) plus the Advanced mode-flag disclosure — the channel's mode is
 * still editable, scoped to the provider.
 */
export function renderExpanderPin(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
  identity: string,
  rawValue: unknown,
  boardPreset: boolean
): TemplateResult {
  const [provider, hub, channel] = identity.split(":");
  const address = expanderHubAddress(hub);
  const guarded = boardPreset && !effectiveDisabled(entry, ctx);
  return html`
    <div class="field" data-field-key=${fieldKeyAttr(path)}>
      ${renderLabel(entry, ctx, { path })}
      <input
        type="text"
        readonly
        .value=${
          address === null
            ? ctx.localize("device.pin_on_expander", { provider, hub, channel })
            : ctx.localize("device.pin_on_expander_address", {
                provider,
                address,
                channel,
              })
        }
      />
      ${renderFieldError(path, ctx)}
      ${renderPinWiring({
        entry,
        path,
        ctx,
        rawValue,
        boardPin: null,
        guarded,
      })}
    </div>
  `;
}
