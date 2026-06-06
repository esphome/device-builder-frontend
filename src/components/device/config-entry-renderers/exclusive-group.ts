import { html, nothing } from "lit";
import type { ConfigEntry } from "../../../api/types/config-entries.js";
import { hasSerializableValue } from "../../../util/yaml-serialize.js";
import {
  fieldKeyAttr,
  labelFor,
  renderChildEntries,
  type RenderCtx,
} from "../config-entry-renderers-shared.js";

// Renders entries sharing a backend exclusive_group (a remote_receiver
// binary_sensor's protocols) as one pick-one dropdown plus the chosen
// member's fields. ESPHome accepts exactly one, so only the selected
// member's key stays in the values dict.
export function renderExclusiveGroupField(members: ConfigEntry[], ctx: RenderCtx) {
  const present = members.filter((m) => hasSerializableValue(ctx.getAt([m.key])));
  const selectedKey = present[0]?.key ?? "";
  const selected = members.find((m) => m.key === selectedKey);
  const disabled = ctx.disabled;

  // Clear every other member so the YAML keeps a single key; scaffold the
  // chosen one with {} so its fields render.
  const onChange = (newKey: string) => {
    for (const m of members) {
      if (m.key !== newKey) ctx.emitChange([m.key], undefined);
    }
    if (newKey) ctx.emitChange([newKey], {});
  };

  // data-no-value-sync: the select's value is derived (which member is
  // present), not a YAML path, so the form syncs it via the selected
  // option rather than a path lookup.
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
      ${selected ? renderChildEntries(selected, [selected.key], ctx) : nothing}
    </div>
  `;
}
