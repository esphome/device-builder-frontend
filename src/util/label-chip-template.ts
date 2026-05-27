/**
 * Shared rendering helpers for label chips.
 *
 * Card view, table cell, drawer section, filter popover, editor —
 * every surface that displays a label uses the same pill shape and
 * background tinting. Centralising the styles + template here keeps
 * the visual treatment in lockstep across components without
 * duplicating CSS in each shadow DOM.
 *
 * Consumers: import ``labelChipStyles`` into their ``static styles``
 * array and call ``renderLabelChip`` / ``renderLabelChips`` from
 * their own template.
 */
import { css, html, nothing, type CSSResult, type TemplateResult } from "lit";
import type { Label } from "../api/types.js";
import { labelChipStyleString } from "./label-style.js";

export const labelChipStyles: CSSResult = css`
  .label-chips {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }

  .label-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-bold);
    line-height: 1.4;
    border: var(--wa-border-width-s) solid transparent;
    white-space: nowrap;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Overflow chip ("+N") — uses the neutral palette regardless of
     what the hidden labels themselves use, since it represents the
     count, not any individual label's identity. */
  .label-chip--overflow {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-quiet);
    border-color: var(--wa-color-surface-border);
  }

  /* Unknown-id placeholder. Renders when a device references a
     label id that isn't in the catalog yet (race during load) or
     was just deleted before the cascade reached this device.
     Stays visually distinct so the user notices the discrepancy. */
  .label-chip--unknown {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-quiet);
    border-color: var(--wa-color-surface-border);
    font-style: italic;
  }
`;

export function renderLabelChip(label: Label): TemplateResult {
  return html`<span
    class="label-chip"
    style=${labelChipStyleString(label.color)}
    title=${label.name}
    >${label.name}</span
  >`;
}

/** Render a (possibly truncated) list of label chips.
 *
 *  ``max`` caps how many chips render before collapsing the rest
 *  into a "+N" overflow chip; the overflow chip's tooltip lists the
 *  hidden labels by name. Pass ``null`` / omit ``max`` to render
 *  every chip. Returns ``nothing`` for an empty list so the caller
 *  doesn't have to gate. */
export function renderLabelChips(
  labels: Label[],
  options: { max?: number | null } = {}
): TemplateResult | typeof nothing {
  if (labels.length === 0) return nothing;
  const max = options.max ?? null;
  if (max === null || labels.length <= max) {
    return html`<span class="label-chips"> ${labels.map(renderLabelChip)} </span>`;
  }
  const visible = labels.slice(0, max);
  const hidden = labels.slice(max);
  const overflowTitle = hidden.map((l) => l.name).join(", ");
  return html`<span class="label-chips">
    ${visible.map(renderLabelChip)}
    <span class="label-chip label-chip--overflow" title=${overflowTitle}
      >+${hidden.length}</span
    >
  </span>`;
}

/** Resolve label ids against the catalog, dropping unknown ids.
 *
 *  Stable in source order: the device carries assignments in
 *  insertion order, so the chip row visually reflects "the order I
 *  added these tags" rather than the catalog's own order. Unknown
 *  ids are silently skipped — see ``label-chip--unknown`` for the
 *  rare-but-possible "in-flight" case the consumer can handle by
 *  rendering a placeholder chip alongside the resolved set. */
export function resolveLabelIds(
  ids: readonly string[] | null | undefined,
  catalog: readonly Label[]
): Label[] {
  if (!ids || ids.length === 0) return [];
  const byId = new Map(catalog.map((l) => [l.id, l]));
  const out: Label[] = [];
  for (const id of ids) {
    const label = byId.get(id);
    if (label) out.push(label);
  }
  return out;
}
