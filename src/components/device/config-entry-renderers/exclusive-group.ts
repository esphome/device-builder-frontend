import { html, nothing } from "lit";
import type { ConfigEntry } from "../../../api/types/config-entries.js";
import { hasSerializableValue } from "../../../util/yaml-serialize.js";
import {
  fieldKeyAttr,
  labelFor,
  type RenderCtx,
} from "../config-entry-renderers-shared.js";

// Renders a set of mutually-exclusive sibling entries (backend
// `exclusive_group`, e.g. a remote_receiver binary_sensor's protocols)
// as one pick-one dropdown plus the chosen member's fields. ESPHome
// accepts exactly one, so the form must too: only the selected member's
// key stays in the values dict.
export function renderExclusiveGroupField(members: ConfigEntry[], ctx: RenderCtx) {
  const present = members.filter((m) => hasSerializableValue(ctx.getAt([m.key])));
  const selectedKey = present[0]?.key ?? "";
  const selected = members.find((m) => m.key === selectedKey);
  const disabled = ctx.disabled;

  // Switching protocols clears every other member so the YAML keeps a
  // single key; scaffold the chosen one with {} so its fields render.
  const onChange = (newKey: string) => {
    for (const m of members) {
      if (m.key !== newKey) ctx.emitChange([m.key], undefined);
    }
    if (newKey) ctx.emitChange([newKey], {});
  };

  // Render the selected member's children directly (not as a collapsible
  // group): the dropdown already names the choice, and a freshly
  // scaffolded {} wouldn't auto-expand.
  const fields = selected
    ? ctx
        .filterRenderable(selected.config_entries ?? [], ctx.scopeValues([selected.key]))
        .map((child) => ctx.renderEntry(child, [selected.key, child.key]))
    : nothing;

  return html`
    <div class="field" data-field-key=${fieldKeyAttr([members[0].key])}>
      <label class="field-label">
        ${ctx.localize("device.exclusive_group_label")}
        <span class="required">*</span>
      </label>
      <wa-select
        data-no-value-sync
        ?disabled=${disabled}
        @change=${(e: Event) =>
          onChange((e.target as unknown as { value: string }).value)}
      >
        <wa-option value=${""} ?selected=${selectedKey === ""}>
          ${ctx.localize("device.exclusive_group_placeholder")}
        </wa-option>
        ${members.map(
          (m) =>
            html`<wa-option value=${m.key} ?selected=${m.key === selectedKey}
              >${labelFor(m, ctx)}</wa-option
            >`
        )}
      </wa-select>
      ${present.length > 1
        ? html`<p class="field-description exclusive-group-conflict">
            ${ctx.localize("device.exclusive_group_conflict")}
          </p>`
        : nothing}
      ${fields}
    </div>
  `;
}
