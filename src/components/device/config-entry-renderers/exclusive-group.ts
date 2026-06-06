import { html, nothing } from "lit";
import type { ConfigEntry } from "../../../api/types/config-entries.js";
import {
  fieldKeyAttr,
  labelFor,
  renderChildEntries,
  type RenderCtx,
} from "../config-entry-renderers-shared.js";

// Partition a flat entry list into the mutually-exclusive groups
// (keyed by exclusive_group) and the remaining entries, preserving order.
// Lives here so the form's render() stays small.
export function partitionExclusiveGroups(entries: ConfigEntry[]): {
  rest: ConfigEntry[];
  groups: ConfigEntry[][];
} {
  const groups = new Map<string, ConfigEntry[]>();
  const rest: ConfigEntry[] = [];
  for (const entry of entries) {
    if (entry.exclusive_group) {
      const group = groups.get(entry.exclusive_group) ?? [];
      group.push(entry);
      groups.set(entry.exclusive_group, group);
    } else {
      rest.push(entry);
    }
  }
  return { rest, groups: [...groups.values()] };
}

// Renders entries sharing a backend exclusive_group (a remote_receiver
// binary_sensor's protocols) as one pick-one dropdown plus the chosen
// member's fields. ESPHome accepts exactly one, so only the selected
// member's key stays in the values dict.
export function renderExclusiveGroupField(members: ConfigEntry[], ctx: RenderCtx) {
  // Membership is "key present in values": emitChange clears a member by
  // writing undefined, so only undefined means absent — a scaffolded {} or
  // an explicit null (hand-written raw:) both count as the chosen member.
  const present = members.filter((m) => ctx.getAt([m.key]) !== undefined);
  const selectedKey = present[0]?.key ?? "";
  const selected = members.find((m) => m.key === selectedKey);
  const disabled = ctx.disabled;

  // Clear every other member so the YAML keeps a single key; scaffold the
  // chosen one with {} only when it's absent, so switching to a member that
  // already has config (conflict resolution) keeps its values.
  const onChange = (newKey: string) => {
    for (const m of members) {
      if (m.key !== newKey) ctx.emitChange([m.key], undefined);
    }
    if (newKey && ctx.getAt([newKey]) === undefined) ctx.emitChange([newKey], {});
  };

  // data-no-value-sync: the select's value is derived (which member is
  // present), not a YAML path, so the form syncs it via the selected
  // option rather than a path lookup.
  return html`
    <div class="field" data-field-key=${fieldKeyAttr(selected ? [selected.key] : [])}>
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
      ${selected
        ? renderChildEntries(selected, [selected.key], ctx, { includeAdvanced: true })
        : nothing}
    </div>
  `;
}
