import { html, type TemplateResult } from "lit";
import type { ConfigEntry } from "../../../api/types/config-entries.js";
import { isPlainObject } from "../../../util/nested-values.js";
import { expanderHubAddress, providerKeyOf } from "../../../util/pin/gpio.js";
import {
  isSubstitutionString,
  resolveSubstitutions,
} from "../../../util/substitutions.js";
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
  identity: string | null,
  rawValue: unknown,
  boardPreset: boolean
): TemplateResult {
  const [provider, hub, channel] =
    identity?.split(":") ?? rawExpanderParts(rawValue as Record<string, unknown>);
  const address = expanderHubAddress(hub);
  const guarded = boardPreset && !effectiveDisabled(entry, ctx);
  return html`
    <div class="field" data-field-key=${fieldKeyAttr(path)}>
      ${renderLabel(entry, ctx, { path })}
      <input
        type="text"
        readonly
        .value=${
          hub === ""
            ? ctx.localize("device.pin_on_expander_unresolved", { provider, channel })
            : address === null
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

/** *rawValue* with substitutions resolved in its expander hub value (id or address). */
export function resolveExpanderHub(
  rawValue: unknown,
  subs: Map<string, string> | undefined
): unknown {
  const provider = providerKeyOf(rawValue);
  if (provider === undefined || !isPlainObject(rawValue)) return rawValue;
  const hub = rawValue[provider];
  if (typeof hub === "string") {
    return { ...rawValue, [provider]: resolveSubstitutions(hub, subs) };
  }
  if (isPlainObject(hub) && typeof hub.address === "string") {
    return {
      ...rawValue,
      [provider]: { ...hub, address: resolveSubstitutions(hub.address, subs) },
    };
  }
  return rawValue;
}

/** Display parts of an unresolvable expander pin; only an external substitution keeps its hub text. */
function rawExpanderParts(rawValue: Record<string, unknown>): string[] {
  const provider = providerKeyOf(rawValue) ?? "";
  const hub = rawValue[provider];
  const address = isPlainObject(hub) ? hub.address : undefined;
  const hubText =
    typeof hub === "string" ? hub : isSubstitutionString(address) ? `@${address}` : "";
  return [provider, hubText, String(rawValue.number ?? "")];
}
