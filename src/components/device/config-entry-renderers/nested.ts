import { html, nothing } from "lit";
import type { ConfigEntry } from "../../../api/types/config-entries.js";
import { renderMarkdown } from "../../../util/markdown.js";
import { isPlainObject } from "../../../util/nested-values.js";
import { hasSerializableValue } from "../../../util/yaml-serialize.js";
import {
  effectiveDisabled,
  fieldKeyAttr,
  labelFor,
  renderChildEntries,
  type RenderCtx,
  renderFieldError,
  renderHelpLink,
  renderLabel,
} from "../config-entry-renderers-shared.js";
import { hasNameChild, seedIdFor } from "./seed-identity.js";

// Stash of the values a sub-reading held when its enable switch was
// turned off, keyed by the form's ``stashOwner`` (the host element,
// stable across re-renders) then the dotted path. Turning the switch
// back on restores the stash so an accidental toggle doesn't wipe the
// unit / accuracy / filters the user configured — only the next flip
// back recovers it (mirrors the templatable literal/lambda stash).
const _enableStashes = new WeakMap<object, Map<string, Record<string, unknown>>>();

function _enableStash(ctx: RenderCtx): Map<string, Record<string, unknown>> {
  let m = _enableStashes.get(ctx.stashOwner);
  if (!m) {
    m = new Map();
    _enableStashes.set(ctx.stashOwner, m);
  }
  return m;
}

// The set tracks groups that are *open*. A group seeds open once when it's
// required or already carries a value (see seedNestedOpen below); optional
// empty groups stay collapsed until the user expands them.
export function renderNestedField(entry: ConfigEntry, path: string[], ctx: RenderCtx) {
  // A scalar at a NESTED key (an unmodellable shorthand the user set in
  // YAML) renders read-only with its value, not as an empty flag group.
  // Only a scalar that actually serializes gets the notice — a cleared ""
  // never lands in YAML, so it falls through to the flag-group editor.
  const raw = ctx.getAt(path);
  if (
    !entry.multi_value &&
    hasSerializableValue(raw) &&
    (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean")
  ) {
    return html`
      <div class="field" data-field-key=${fieldKeyAttr(path)}>
        ${renderLabel(entry, ctx, { path })}
        <p class="field-description">
          ${ctx.localize("device.value_set_in_yaml", { value: String(raw) })}
        </p>
        ${renderFieldError(path, ctx)}
      </div>
    `;
  }
  const key = path.join(".");
  // A group that already carries a value in the YAML, or is itself
  // required (its required children must be filled), opens once so its
  // fields are visible without a manual expand (advanced groups like
  // remote_receiver's raw are otherwise collapsed). seedNestedOpen is
  // one-shot, so a later user collapse sticks.
  if (entry.required || hasSerializableValue(raw)) ctx.seedNestedOpen(key);
  const isOpen = ctx.nestedOpenSections.has(key);
  // Optional entity sub-readings (a debug component's per-metric sensors,
  // a DHT's temperature/humidity, …) are only written to YAML once their
  // group holds a value, so an untouched one is silently "off". Give those
  // an explicit enable switch; plain nested forms (platform_type === null)
  // and required groups keep the bare collapsible header.
  const isOptionalEntity = entry.platform_type != null && !entry.required;
  const enabled = isOptionalEntity && hasSerializableValue(raw);
  const label = labelFor(entry, ctx);
  const enableLabel = ctx.localize("device.enable_entity", { name: label });
  return html`
    <div class="nested-group" data-field-key=${fieldKeyAttr(path)}>
      <div class="nested-header">
        ${
          isOptionalEntity
            ? html`<wa-switch
                class="nested-enable"
                .checked=${enabled}
                ?disabled=${effectiveDisabled(entry, ctx)}
                aria-label=${enableLabel}
                title=${enableLabel}
                @change=${(e: Event) =>
                  onEnableToggle({
                    entry,
                    path,
                    key,
                    isOpen,
                    checked: (e.target as unknown as { checked: boolean }).checked,
                    label,
                    ctx,
                  })}
              ></wa-switch>`
            : nothing
        }
        <button
          type="button"
          class="nested-toggle"
          aria-expanded=${isOpen}
          @click=${() => ctx.toggleNested(key)}
        >
          <wa-icon library="mdi" name=${isOpen ? "chevron-up" : "chevron-down"}></wa-icon>
          <span class="nested-title">${label}</span>
          ${
            entry.platform_type
              ? html`<span class="nested-platform">${entry.platform_type}</span>`
              : nothing
          }
        </button>
        ${renderHelpLink(entry, ctx)}
      </div>
      ${
        entry.description
          ? html`<p class="nested-desc">${renderMarkdown(entry.description)}</p>`
          : nothing
      }
      ${
        isOpen
          ? html`<div class="nested-fields">${renderChildEntries(entry, path, ctx)}</div>`
          : nothing
      }
    </div>
  `;
}

// Enabling restores the values stashed by the last disable (so an
// accidental off/on round-trip keeps the user's settings); with no
// stash it seeds whichever identity field the group's schema offers, so
// the group becomes non-empty and serializes. Either way it expands for
// editing. Disabling stashes the current group, then clears it — the
// serializer prunes the empty object so the block leaves the YAML — and
// collapses. Exported for direct unit testing (the render path only
// wires it up).
export function onEnableToggle(opts: {
  entry: ConfigEntry;
  path: string[];
  key: string;
  isOpen: boolean;
  checked: boolean;
  label: string;
  ctx: RenderCtx;
}): void {
  const { entry, path, key, isOpen, checked, label, ctx } = opts;
  const stash = _enableStash(ctx);
  if (checked) {
    const restored = stash.get(key);
    if (restored && hasSerializableValue(restored)) {
      stash.delete(key);
      ctx.emitChange(path, restored);
    } else if (hasNameChild(entry)) {
      // Seed the *localized* label the user is looking at, so the
      // name they get matches the switch they clicked (WYSIWYG) and
      // reads natively in their dashboard locale. It's a plain
      // editable value, not locale-pinned state — don't "fix" this
      // to the entry key.
      ctx.emitChange([...path, "name"], label);
    } else {
      // A nameless group (pipsolar's output sub-entities, opentherm's)
      // rejects ``name:`` outright, so seed its id instead — required or
      // not, it's the only identity the group has to serialize on.
      const seed = seedIdFor(entry, ctx);
      // With neither (a light's ``initial_state``) there's nothing valid to
      // write, so re-emit the still-absent group: the switch the user just
      // clicked has no backing value, and only a re-render walks it back to
      // off. The group persists once they set one of its own fields. This
      // leans on the host handing itself a fresh values object for every
      // ``value-change``, no-op included (``setIn`` spreads unconditionally) —
      // an identity-preserving fast path there would strand the switch on.
      if (seed) ctx.emitChange([...path, seed.key], seed.id);
      else ctx.emitChange(path, undefined);
    }
    if (!isOpen) ctx.toggleNested(key);
  } else {
    // A sub-reading's value is always a plain object; narrow on that
    // (not the broader hasSerializableValue, which is also true for
    // scalars / arrays) so the stashed type is genuinely a Record.
    const current = ctx.getAt(path);
    if (isPlainObject(current) && hasSerializableValue(current)) {
      stash.set(key, current);
    }
    ctx.emitChange(path, undefined);
    if (isOpen) ctx.toggleNested(key);
  }
}
