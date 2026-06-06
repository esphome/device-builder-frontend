import { html, nothing } from "lit";
import type { ConfigEntry } from "../../../api/types/config-entries.js";
import {
  fieldKeyAttr,
  labelFor,
  renderChildEntries,
  type RenderCtx,
} from "../config-entry-renderers-shared.js";

// Placeholder option value. A non-empty sentinel (not "") so the form's
// _syncSelectedAttr — which no-ops on an empty value — still drives the
// select to the placeholder on first paint; mapped back to "" in onChange.
const NO_SELECTION = "__none__";

// The form's entries in schema order, with each exclusive_group collapsed
// to its member array at the position of its first member; non-exclusive
// entries pass through for the caller to filter and render. Lives here so
// the form's render() stays small.
export function orderExclusiveGroups(
  entries: ConfigEntry[]
): (ConfigEntry | ConfigEntry[])[] {
  const byId = new Map<string, ConfigEntry[]>();
  for (const entry of entries) {
    if (entry.exclusive_group) {
      const group = byId.get(entry.exclusive_group) ?? [];
      group.push(entry);
      byId.set(entry.exclusive_group, group);
    }
  }
  const seen = new Set<string>();
  const out: (ConfigEntry | ConfigEntry[])[] = [];
  for (const entry of entries) {
    if (!entry.exclusive_group) {
      out.push(entry);
    } else if (!seen.has(entry.exclusive_group)) {
      seen.add(entry.exclusive_group);
      out.push(byId.get(entry.exclusive_group)!);
    }
  }
  return out;
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
        @change=${(e: Event) => {
          const value = (e.target as unknown as { value: string }).value;
          onChange(value === NO_SELECTION ? "" : value);
        }}
      >
        <wa-option value=${NO_SELECTION} ?selected=${selectedKey === ""}>
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
        ? html`<div class="nested-fields">
            ${renderChildEntries(selected, [selected.key], ctx, {
              includeAdvanced: true,
            })}
          </div>`
        : nothing}
    </div>
  `;
}
