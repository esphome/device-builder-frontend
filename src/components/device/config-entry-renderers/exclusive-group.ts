import { html, nothing } from "lit";
import type { ConfigEntry } from "../../../api/types/config-entries.js";
import { isEntryVisible } from "../../../util/config-validation.js";
import {
  fieldKeyAttr,
  labelFor,
  renderChildEntries,
  type RenderCtx,
} from "../config-entry-renderers-shared.js";

// Non-empty sentinel so the group always has a `?selected` option for
// _syncSelectedAttr to push on first paint; mapped back to "" in onChange.
const NO_SELECTION = "__none__";

// Fold each exclusive_group to its member array at its first member's slot;
// other entries pass through. Keeps the form's render() small.
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

// One exclusive_group as a pick-one dropdown plus the chosen member's
// fields; ESPHome accepts exactly one, so only that key stays in values.
export function renderExclusiveGroupField(members: ConfigEntry[], ctx: RenderCtx) {
  // emitChange clears with undefined, so only undefined is absent — a
  // scaffolded {} or an explicit null both count as the chosen member.
  const present = members.filter((m) => ctx.getAt([m.key]) !== undefined);
  const selectedKey = present[0]?.key ?? "";
  const selected = members.find((m) => m.key === selectedKey);

  // Gate options through isEntryVisible so a board-incompatible / hidden /
  // depends_on member can't be picked; keep an already-set one selectable.
  const rootValues = ctx.scopeValues([]);
  const targetPlatform = ctx.board?.esphome.platform ?? null;
  const options = members.filter(
    (m) =>
      ctx.getAt([m.key]) !== undefined ||
      isEntryVisible(m, rootValues, ctx.presentComponents, targetPlatform)
  );

  // Every *rendered* option board-locked → the choice is fixed; render the
  // dropdown read-only so it matches `planNeedsUserInput` treating it as
  // non-actionable. Use options, not all members: a hidden unlocked member
  // (e.g. platform-incompatible) isn't selectable and shouldn't keep it live.
  const disabled = ctx.disabled || options.every((m) => m.locked);

  // Clear only the members actually present (avoids ~N redundant events and
  // stray key: undefined state); scaffold {} only for an absent choice, so
  // resolving a conflict doesn't overwrite the kept member's values.
  const onChange = (newKey: string) => {
    for (const m of members) {
      if (m.key !== newKey && ctx.getAt([m.key]) !== undefined) {
        ctx.emitChange([m.key], undefined);
      }
    }
    if (newKey && ctx.getAt([newKey]) === undefined) ctx.emitChange([newKey], {});
  };

  // data-no-value-sync: value is derived (which member is present), not a
  // YAML path, so the form sets it from the selected option; aria-labelledby
  // gives the select its name.
  const labelId = `exclusive-group-${members[0].key}`;
  return html`
    <div class="field" data-field-key=${fieldKeyAttr(selected ? [selected.key] : [])}>
      <label class="field-label" id=${labelId}>
        ${ctx.localize("device.exclusive_group_label")}
        <span class="required">*</span>
      </label>
      <wa-select
        data-no-value-sync
        aria-labelledby=${labelId}
        ?disabled=${disabled}
        @change=${(e: Event) => {
          const value = (e.target as unknown as { value: string }).value;
          onChange(value === NO_SELECTION ? "" : value);
        }}
      >
        <wa-option value=${NO_SELECTION} ?selected=${selectedKey === ""}>
          ${ctx.localize("device.exclusive_group_placeholder")}
        </wa-option>
        ${options.map(
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
