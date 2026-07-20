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
  isCertainlyDanglingId,
  resolveSoleCandidate,
} from "../../util/config-entry-yaml-scan.js";
import { renderInlineError } from "../../util/render-error.js";
import { resolveSubstitutions } from "../../util/substitutions.js";
import {
  effectiveDisabled,
  fieldKeyAttr,
  renderFieldError,
  renderLabel,
  renderYamlOnlyFallbackIfNonPrimitive,
  type RenderCtx,
} from "./config-entry-renderers-shared.js";

export const ADD_NEW_SENTINEL = "__esphome_add_new__";
export const AUTO_SENTINEL = "__esphome_auto__";

export function renderIdReferenceField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx
) {
  const domain = entry.references_component || "";
  const providers = ctx.resolveInterfaceProviders(domain);
  const candidates = findReferenceCandidates(ctx.yaml, domain, providers ?? []);
  const raw = ctx.getAt(path);
  const bail = renderYamlOnlyFallbackIfNonPrimitive(entry, path, ctx, raw);
  if (bail) return bail;
  const value = String(raw ?? "");
  const fieldError = ctx.errorAt(path) !== null;

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
  // A dangling reference we can be sure about gets an inline error without
  // waiting for the backend lint round trip. The renderer gates on its own
  // state — backend validation stays the authority, and the provider fetch
  // must have settled (candidate list complete) — the certainty verdict
  // itself lives beside the candidate scan.
  const unknownId =
    !fieldError &&
    providers !== null &&
    isCertainlyDanglingId(value, candidates, ctx.yaml);
  const invalid = fieldError || unknownId;
  const unknownIdError = unknownId
    ? renderInlineError(ctx.localize("device.id_reference_unknown_error", { id: value }))
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
    // Empty string clears the key on serialization in every form host,
    // reverting the field to ESPHome's auto-resolved instance.
    ctx.emitChange(path, next === AUTO_SENTINEL ? "" : next);
  };

  // Revert-to-auto for an optional reference with a committed value — the
  // only visual-editor way out of a dangling id (e.g. the synthetic
  // ``logger_id: logger`` older builds pre-filled, #2208). An empty field
  // already reads as auto via the default-candidate placeholder, so the
  // option only appears once a value is set.
  const autoOption =
    !entry.required && value !== ""
      ? idOption(
          AUTO_SENTINEL,
          ctx.localize("device.id_reference_auto"),
          ctx.localize("device.id_reference_auto_detail", { domain })
        )
      : nothing;

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
          class=${fieldError ? "invalid" : ""}
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
        placeholder=${
          defaultCandidate
            ? resolveSubstitutions(defaultCandidate.name, ctx.substitutions) ||
              defaultCandidate.id
            : nothing
        }
        @change=${onChange}
      >
        ${autoOption} ${orphanOption}
        ${candidates.map((c) => {
          const secondary = c.name ? `${c.id} · ${domain}` : domain;
          // The label is display-only; the stored value stays c.id. Resolve
          // ${...} so the picker shows the same name the text field previews.
          const displayName = resolveSubstitutions(c.name, ctx.substitutions);
          return idOption(
            c.id,
            displayName || c.id,
            c === defaultCandidate
              ? `${secondary} · ${ctx.localize("device.default_option_tag")}`
              : secondary
          );
        })}
        ${addOption}
      </wa-select>
      ${renderFieldError(path, ctx)}${unknownIdError}
    </div>
  `;
}
