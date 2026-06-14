/**
 * ID-reference picker renderer. The "+ Add new <domain>" entry uses
 * a sentinel value so the form can intercept the select's `change`
 * event and route to the add-component flow instead of writing the
 * literal sentinel as a config value.
 */

import { html, nothing } from "lit";
import type { ConfigEntry } from "../../api/types/config-entries.js";
import {
  findReferenceCandidates,
  resolveSoleCandidate,
} from "../../util/config-entry-yaml-scan.js";
import {
  effectiveDisabled,
  fieldKeyAttr,
  renderFieldError,
  renderLabel,
  renderYamlOnlyFallbackIfNonPrimitive,
  type RenderCtx,
} from "./config-entry-renderers-shared.js";

export const ADD_NEW_SENTINEL = "__esphome_add_new__";

export function renderIdReferenceField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx
) {
  const domain = entry.references_component || "";
  const candidates = findReferenceCandidates(
    ctx.yaml,
    domain,
    ctx.resolveInterfaceProviders(domain)
  );
  const raw = ctx.getAt(path);
  const bail = renderYamlOnlyFallbackIfNonPrimitive(entry, path, ctx, raw);
  if (bail) return bail;
  const value = String(raw ?? "");
  const invalid = ctx.errorAt(path) !== null;

  // Surface ESPHome's auto-resolved target as the default, but only on an
  // empty field — a committed value isn't a "default".
  const defaultCandidate =
    value === "" ? resolveSoleCandidate(candidates, ctx.yaml) : null;

  const idOption = (optValue: string, primary: string, secondary: string) => html`
    <wa-option
      class="id-option"
      value=${optValue}
      .label=${primary}
      ?selected=${optValue === value}
    >
      <span class="id-option-stack">
        <span class="id-option-primary">${primary}</span>
        <span class="id-option-secondary">${secondary}</span>
      </span>
    </wa-option>
  `;

  // The current id may not be a local candidate: defined in a `packages:`
  // include / another file the scan can't see, or a dangling reference (typo,
  // deleted id). We can't tell which, so surface it as a selected option with
  // provenance-neutral copy rather than dropping it on save.
  const hasOrphanValue = value !== "" && !candidates.some((c) => c.id === value);
  const orphanOption = hasOrphanValue
    ? idOption(value, value, ctx.localize("device.id_reference_unresolved", { domain }))
    : nothing;
  // Solo "Add new" CTA only when there's genuinely nothing to show.
  const empty = candidates.length === 0 && !hasOrphanValue;

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
      <div class="field" data-field-key=${fieldKeyAttr(path)}>
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
    <div class="field" data-field-key=${fieldKeyAttr(path)}>
      ${renderLabel(entry, ctx)}
      <wa-select
        class=${invalid ? "invalid" : ""}
        ?disabled=${effectiveDisabled(entry, ctx)}
        placeholder=${defaultCandidate
          ? defaultCandidate.name || defaultCandidate.id
          : nothing}
        @change=${onChange}
      >
        ${orphanOption}
        ${candidates.map((c) => {
          const secondary = c.name ? `${c.id} · ${domain}` : domain;
          return idOption(
            c.id,
            c.name || c.id,
            c === defaultCandidate
              ? `${secondary} · ${ctx.localize("device.default_option_tag")}`
              : secondary
          );
        })}
        ${addOption}
      </wa-select>
      ${renderFieldError(path, ctx)}
    </div>
  `;
}
