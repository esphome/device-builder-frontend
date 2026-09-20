import { html, nothing } from "lit";
import type { ConfigEntry } from "../../../api/types/config-entries.js";
import { ConfigEntryType } from "../../../api/types/config-entries.js";
import { renderMarkdown } from "../../../util/markdown.js";
import { isPlainObject, isPrimitiveOrNullish } from "../../../util/nested-values.js";
import { maskSensitiveLines } from "../../../util/yaml-sensitive-redact.js";
import { hasSerializableValue } from "../../../util/yaml-serialize.js";
import { enableSeed, isSwitchable } from "../config-entry-enable-seed.js";
import { ownRequiredGroups } from "../config-entry-render-filter.js";
import {
  describedText,
  effectiveDisabled,
  fieldKeyAttr,
  filterOptionsAt,
  labelFor,
  type RenderCtx,
  renderFieldError,
  renderHelpLink,
  renderLabel,
} from "../config-entry-renderers-shared.js";
import { renderConstraintBanners } from "./constraint-banner-view.js";
import { nextIdFor } from "./seed-identity.js";

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
  // A block with nothing to show here (the add form drops emc2101's
  // advanced-only children) never opens: an empty body reads broken.
  // The block's own required groups bind once it is in use: their members
  // stay visible and an unmet one is named inside the box.
  const scope = ctx.scopeValues(path);
  const inUse = hasSerializableValue(raw);
  const ownGroups = ownRequiredGroups(entry, raw);
  const children = ctx.filterRenderable(entry.config_entries ?? [], scope, ownGroups);
  const hasFields = children.length > 0;
  if (hasFields && (entry.required || inUse)) ctx.seedNestedOpen(key);
  // The toggle keeps its books on the raw set; only the paint is gated, so a
  // block that later gains a field opens as the user last left it.
  const userOpen = ctx.nestedOpenSections.has(key);
  const isOpen = hasFields && userOpen;
  // Optional entity sub-readings (a debug component's per-metric sensors,
  // a DHT's temperature/humidity, …) are only written to YAML once their
  // group holds a value, so an untouched one is silently "off". Give those
  // an explicit enable switch; plain nested forms (platform_type === null)
  // and required groups keep the bare collapsible header.
  const isOptionalEntity = entry.platform_type != null && !entry.required;
  // A plain block a required group demands (emc2101's pwm / dac) may have no
  // field the form paints, so the switch is how the user picks it. Offered
  // only when it has something to write.
  const isDemanded = isSwitchable(entry, filterOptionsAt(ctx, path));
  const hasSwitch = isOptionalEntity || isDemanded;
  const enabled = hasSwitch && inUse;
  const label = labelFor(entry, ctx);
  const enableLabel = ctx.localize("device.enable_entity", { name: label });
  // A demanded block's own baked prose goes too (emc2101's pwm / dac).
  const description = describedText(entry, path, ctx);
  // Name what the block holds that the form does not paint: everything in a
  // fieldless block, else a valued child the filter drops (a seeded default
  // in required-only mode). Nothing to say when only nested values are left.
  const painted = new Set(children.map((c) => c.key));
  const setValues = enabled ? setValuesOf(entry, raw, ctx, painted) : "";
  // With nothing to expand, the header is a plain title: the switch is the
  // block's only control.
  const title = html`<span class="nested-title">${label}</span>
    ${entry.platform_type ? html`<span class="nested-platform">${entry.platform_type}</span>` : nothing}`;
  return html`
    <div class="nested-group" data-field-key=${fieldKeyAttr(path)}>
      <div class="nested-header">
        ${
          hasSwitch
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
                    isOpen: userOpen,
                    checked: (e.target as unknown as { checked: boolean }).checked,
                    label,
                    ctx,
                  })}
              ></wa-switch>`
            : nothing
        }
        ${
          hasFields
            ? html`<button
                type="button"
                class="nested-toggle"
                aria-expanded=${isOpen}
                @click=${() => ctx.toggleNested(key)}
              >
                <wa-icon
                  library="mdi"
                  name=${isOpen ? "chevron-up" : "chevron-down"}
                ></wa-icon>
                ${title}
              </button>`
            : html`<span class="nested-toggle nested-toggle--static">${title}</span>`
        }
        ${renderHelpLink(entry, ctx)}
      </div>
      ${
        description
          ? html`<p class="nested-desc">${renderMarkdown(description)}</p>`
          : nothing
      }
      ${
        setValues
          ? html`<p class="nested-desc">
              ${ctx.localize("device.enabled_block_sets", { values: setValues })}
            </p>`
          : nothing
      }
      ${
        isOpen
          ? html`<div class="nested-fields">
              ${
                inUse
                  ? renderConstraintBanners(
                      {
                        entries: entry.config_entries ?? [],
                        requiredGroups: ownGroups,
                        values: scope,
                        // As the paint resolves them, board-implied values included.
                        rootValues: filterOptionsAt(ctx, path).rootValues,
                      },
                      NO_CLUSTERS,
                      ctx
                    )
                  : nothing
              }
              ${children.map((child) => ctx.renderEntry(child, [...path, child.key]))}
            </div>`
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
    } else {
      seedFor(entry, path, label, ctx);
    }
    // A block with no paintable field renders closed whatever this says.
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

// Writes the value that switching *entry* on seeds it with.
function seedFor(
  entry: ConfigEntry,
  path: string[],
  label: string,
  ctx: RenderCtx
): void {
  const seed = enableSeed(entry, filterOptionsAt(ctx, path));
  // The *localized* label the user is looking at seeds an entity's name, so
  // it matches the switch they clicked (WYSIWYG) and reads natively in their
  // dashboard locale. It's a plain editable value, not locale-pinned state —
  // don't "fix" this to the entry key. A nameless group (pipsolar's output
  // sub-entities, opentherm's) rejects ``name:`` outright, so it seeds its id
  // instead — required or not, it's the only identity the group has to
  // serialize on. With no identity at all (emc2101's pwm) a child's own
  // default is the smallest value that makes the block serialize.
  const value =
    seed?.from === "name"
      ? label
      : seed?.from === "id"
        ? nextIdFor(entry, ctx)
        : seed?.value;
  // With none of these (a light's ``initial_state``) there's nothing valid to
  // write, so re-emit the still-absent group: the switch the user just
  // clicked has no backing value, and only a re-render walks it back to
  // off. The group persists once they set one of its own fields. This
  // leans on the host handing itself a fresh values object for every
  // ``value-change``, no-op included (``setIn`` spreads unconditionally) —
  // an identity-preserving fast path there would strand the switch on.
  if (!seed || value === undefined) ctx.emitChange(path, undefined);
  else ctx.emitChange([...path, seed.key], value);
}

// A nested scope paints no cluster boxes, so every unmet group gets a banner.
const NO_CLUSTERS: ReadonlySet<string> = new Set();

const MASKED_VALUE = "••••••";

// What a block holds that the form does not paint, so a value the switch
// wrote on the user's behalf is visible where it was written.
function setValuesOf(
  entry: ConfigEntry,
  raw: unknown,
  ctx: RenderCtx,
  painted: ReadonlySet<string>
): string {
  if (!isPlainObject(raw)) return "";
  const children = new Map((entry.config_entries ?? []).map((c) => [c.key, c]));
  return Object.entries(raw)
    .filter(
      ([key, value]) =>
        !painted.has(key) && isPrimitiveOrNullish(value) && hasSerializableValue(value)
    )
    .map(([key, value]) => {
      const child = children.get(key);
      const shown = shownValue(entry.key, key, value, child);
      return `${child ? labelFor(child, ctx) : key}: ${shown}`;
    })
    .join(", ");
}

// A credential is masked in its own field; never spell it out here. The type
// says so for a secure child; for any other key the YAML credential masker
// decides from its spelling, with the block as parent (``key:`` under
// ``encryption:``), so a mistyped or undeclared secret is covered too.
function shownValue(
  parentKey: string,
  key: string,
  value: unknown,
  child: ConfigEntry | undefined
): string {
  if (child?.type === ConfigEntryType.SECURE_STRING) return MASKED_VALUE;
  // Ask about the key with a stand-in value: the real one never enters the
  // synthetic YAML, so a ``#`` or a quote in it can't escape the mask.
  const [, probe] = maskSensitiveLines([`${parentKey}:`, `  ${key}: x`], MASKED_VALUE);
  return probe.includes(MASKED_VALUE) ? MASKED_VALUE : String(value).replace(/\s+/g, " ");
}
