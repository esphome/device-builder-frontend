/**
 * ID-reference picker renderer. The "+ Add new <domain>" entry uses
 * a sentinel value so the form can intercept the select's `change`
 * event and route to the add-component flow instead of writing the
 * literal sentinel as a config value.
 */

import { html } from "lit";
import type { ConfigEntry } from "../../api/types.js";
import { findReferencedComponents } from "../../util/config-entry-yaml-scan.js";
import {
  effectiveDisabled,
  renderFieldError,
  renderLabel,
  type RenderCtx,
} from "./config-entry-renderers-shared.js";

export const ADD_NEW_SENTINEL = "__esphome_add_new__";

export function renderIdReferenceField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx
) {
  const domain = entry.references_component || "";
  const candidates = findReferencedComponents(ctx.yaml, domain);
  const value = String(ctx.getAt(path) ?? "");
  const invalid = ctx.errorAt(path) !== null;
  const empty = candidates.length === 0;

  const onChange = (e: Event) => {
    const select = e.target as HTMLSelectElement;
    const next = select.value;
    if (next === ADD_NEW_SENTINEL) {
      // Revert displayed value so the dropdown isn't stuck showing
      // "Add new …" while we navigate away. (Section editor keeps the
      // form mounted; the dialog case unmounts it.)
      select.value = value;
      ctx.requestAddComponent(domain);
      return;
    }
    ctx.emitChange(path, next);
  };

  // The "Add new <domain>" option lives at the bottom — same
  // affordance as Home Assistant's entity pickers. When it's the
  // only option (empty state) the dropdown is a single CTA.
  const addOption = html`
    <wa-option
      class="id-option id-option-add ${empty ? "id-option-add--solo" : ""}"
      value=${ADD_NEW_SENTINEL}
    >
      <span class="id-option-stack">
        <span class="id-option-primary id-option-primary-add">
          <wa-icon library="mdi" name="plus"></wa-icon>
          ${ctx.localize("device.id_reference_add", { domain })}
        </span>
      </span>
    </wa-option>
  `;

  if (empty) {
    return html`
      <div class="field" data-field-key=${path.join(".")}>
        ${renderLabel(entry, ctx)}
        <wa-select
          class=${invalid ? "invalid" : ""}
          ?disabled=${effectiveDisabled(entry, ctx)}
          placeholder=${ctx.localize("device.id_reference_empty", { domain })}
          @change=${onChange}
        >
          ${addOption}
        </wa-select>
        ${renderFieldError(path, ctx)}
      </div>
    `;
  }

  return html`
    <div class="field" data-field-key=${path.join(".")}>
      ${renderLabel(entry, ctx)}
      <wa-select
        class=${invalid ? "invalid" : ""}
        ?disabled=${effectiveDisabled(entry, ctx)}
        @change=${onChange}
      >
        ${candidates.map(
          (c) =>
            html`<wa-option
              class="id-option"
              value=${c.id}
              .label=${c.name || c.id}
              ?selected=${c.id === value}
            >
              <span class="id-option-stack">
                <span class="id-option-primary">${c.name || c.id}</span>
                <span class="id-option-secondary"
                  >${c.name ? `${c.id} · ${domain}` : domain}</span
                >
              </span>
            </wa-option>`
        )}
        ${addOption}
      </wa-select>
      ${renderFieldError(path, ctx)}
    </div>
  `;
}
