import { clearPathErrors, validateEntries } from "../../../util/config-validation.js";
import { isPlatformComponentId } from "../../../util/featured-id.js";
import { fireEvent } from "../../../util/fire-event.js";
import { formatApiError } from "../../../util/format-api-error.js";
import { setIn } from "../../../util/nested-values.js";
import { notifyError, notifySuccess } from "../../../util/notify.js";
import {
  KEEP_EMPTY_STRING_SECTIONS,
  LIST_SECTIONS,
  resolveSectionEntries,
} from "../../../util/section-entry-overrides.js";
import {
  appendSectionToYaml,
  removeSectionFromYaml,
  updateSectionInYaml,
} from "../../../util/yaml-section-values.js";
import { resolveCurrentFromLine } from "../../../util/yaml-sections.js";
import type { ConfigEntryValueChange } from "../config-entry-form.js";
import type { ESPHomeDeviceSectionConfig } from "../device-section-config.js";
import { fireSectionEvent, prepareSectionEvent } from "../section-editor.js";

// Validates against the *render* schema (resolveSectionEntries), not the raw
// catalog. MAP_SECTIONS (substitutions / packages) carry an irrelevant flat
// catalog schema that doesn't match what the user actually edits in the form —
// using it would surface phantom "missing required" errors per keystroke.
// Pre-save backend lint (validateYaml) is deliberately not wired in here: the
// YAML pane's squiggles (yaml-lint-backend.ts) provide the same lint
// continuously, and the explicit Validate button runs the full ESPHome
// compile against the saved file.
export function flushDraft(host: ESPHomeDeviceSectionConfig): string | null {
  host._draftTimer = null;
  if (!host._config) return null;
  revalidateFields(host);

  const fromLine = resolveCurrentFromLine(host.yaml, host.sectionKey, host.fromLine);
  if (fromLine === undefined) {
    // Section was removed from live YAML between keystroke and debounce
    // (paste / external edit). Drop the splice silently — next picker
    // click re-runs loadConfig against the current YAML.
    host._setDirty(false);
    return null;
  }

  const newYaml = updateSectionInYaml(
    host.yaml,
    host.sectionKey,
    host._values,
    fromLine,
    // Substitutions: user-typed key + cleared value is intentional data
    // and must round-trip. Other MAP sections (packages) treat empty value
    // as an unfilled placeholder — packages schema validator rejects
    // empty-string definitions, so dropping placeholders keeps it loadable.
    { keepEmptyStrings: KEEP_EMPTY_STRING_SECTIONS.has(host.sectionKey) }
  );

  return emitYamlDraft(host, newYaml);
}

/** Recompute the section's field errors against the render schema. */
function revalidateFields(host: ESPHomeDeviceSectionConfig): void {
  if (!host._config) return;
  host._fieldErrors = validateEntries(
    resolveSectionEntries(host.sectionKey, host._config.entries),
    host._values,
    host._presentComponents,
    host.board?.esphome.platform ?? null,
    host.sectionKey
  );
}

/** Clear the dirty flag and, when *newYaml* differs from the live buffer,
 *  publish it as this element's own `yaml-draft` (tagged via
 *  `_lastSelfWrittenYaml` so the parent's loop-back is ignored). */
function emitYamlDraft(host: ESPHomeDeviceSectionConfig, newYaml: string): string | null {
  host._setDirty(false);
  if (newYaml === host.yaml) return null;
  host._lastSelfWrittenYaml = newYaml;
  fireSectionEvent(host, "yaml-draft", {
    configuration: host.configuration,
    yaml: newYaml,
    basedOn: host.yaml,
    node: host,
  });
  return newYaml;
}

export function onValueChange(
  host: ESPHomeDeviceSectionConfig,
  e: CustomEvent<ConfigEntryValueChange>
): void {
  const { path, value } = e.detail;
  host._values = setIn(host._values, path, value);
  host._setDirty(true);
  const errKey = path.join(".");
  const cleared = clearPathErrors(host._fieldErrors, errKey);
  if (cleared) host._fieldErrors = cleared;
  // Same optimistic clear for backend errors on the edited path — per-item
  // keys under it included (a list edit emits at the field path while the
  // backend error keys ``field.1``, #1354). They reappear on the next lint
  // pass if the value is still invalid.
  const itemPrefix = `${errKey}.`;
  let nextCleared: Set<string> | null = null;
  for (const k of host.backendErrors.fields.keys()) {
    if ((k === errKey || k.startsWith(itemPrefix)) && !host._clearedBackendPaths.has(k)) {
      nextCleared ??= new Set(host._clearedBackendPaths);
      nextCleared.add(k);
    }
  }
  if (nextCleared) host._clearedBackendPaths = nextCleared;
  host._scheduleDraftFlush();
}

/** Point the section's field(s) at new values (from a notice banner's
 *  `apply-section-values`) in the unsaved draft and flush the result into the
 *  YAML buffer. Each entry is a `setIn` path and the value to write there
 *  (`undefined` removes the key on serialization). */
export function applySectionValues(
  host: ESPHomeDeviceSectionConfig,
  changes: { path: string[]; value: unknown }[]
): void {
  for (const { path, value } of changes) {
    host._values = setIn(host._values, path, value);
  }
  host._setDirty(true);
  // Cancel any pending debounced flush on both paths below — a keystroke
  // inside the debounce window must not race the deliberate apply.
  if (host._draftTimer !== null) {
    clearTimeout(host._draftTimer);
    host._draftTimer = null;
  }
  // A map-singleton section supplied only by a `packages:` include (api /
  // web_server, reached via the ?section= deep-link) has no local block to
  // splice into, so the flush below would drop the write. Append a fresh
  // top-level block instead; it deep-merges with the package on compile.
  // Restricted to map singletons: a dotted platform section (ota.esphome),
  // a list-bodied one (globals), and a bare platform domain (`sensor:`, also
  // list-bodied) need a list shape / list-merge semantics we can't assume,
  // so those fall through to the flush (unchanged).
  const mapSingleton =
    !isPlatformComponentId(host.sectionKey) &&
    !LIST_SECTIONS.has(host.sectionKey) &&
    !host._isPlatformDomain;
  const absent =
    resolveCurrentFromLine(host.yaml, host.sectionKey, host.fromLine) === undefined;
  if (absent && mapSingleton) {
    createSectionBlock(host);
    return;
  }
  flushDraft(host);
}

/** Append a brand-new top-level block for the applied values, surfaced as an
 *  unsaved draft (the section has no local block, so the splice can't reach it). */
function createSectionBlock(host: ESPHomeDeviceSectionConfig): void {
  revalidateFields(host);
  emitYamlDraft(host, appendSectionToYaml(host.yaml, host.sectionKey, host._values));
}

/**
 * Settle any pending debounced draft and return the freshest buffer
 * this element knows — its ``yaml`` prop lags its own ``yaml-draft``
 * by a render, so a delete basing itself on the raw prop would let
 * the element supersede its own delete. The single settle
 * implementation; ``flushPending`` (the ``SectionEditor`` contract)
 * delegates here but must stay void-returning — the section-switch
 * guard treats any truthy return as a deferred flush. One sub-frame
 * window remains: a draft flushed just before the call whose prop
 * echo hasn't landed returns the pre-flush prop; the page's basis
 * check catches it conservatively (saved-only advance plus toast).
 */
export function settleOwnDraft(host: ESPHomeDeviceSectionConfig): string {
  if (host._draftTimer !== null) {
    clearTimeout(host._draftTimer);
    return flushDraft(host) ?? host.yaml;
  }
  return host.yaml;
}

export async function onDeleteConfirmed(host: ESPHomeDeviceSectionConfig): Promise<void> {
  if (!host._config) return;
  // Settle our own pending draft first: the basis must include the
  // user's last keystroke, or the delete supersedes itself.
  const baseYaml = settleOwnDraft(host);
  const fromLine = resolveCurrentFromLine(baseYaml, host.sectionKey, host.fromLine);
  if (fromLine === undefined) {
    host._error = host._localize("device.section_delete_error");
    return;
  }
  host._deleting = true;
  host._error = "";
  const title = host._config.title;
  const announceUpdated = prepareSectionEvent(host, "yaml-updated");
  // The section key and target are snapshotted: Lit reuses this
  // element across same-kind switches, so a mid-round-trip retarget
  // keeps it connected while the deleted section is no longer on
  // screen.
  const deletedKey = host.sectionKey;
  const configuration = host.configuration;
  try {
    const newYaml = removeSectionFromYaml(baseYaml, host.sectionKey, fromLine);
    if (newYaml === baseYaml) {
      host._error = host._localize("device.section_delete_error");
      return;
    }
    await host._api.updateConfig(configuration, newYaml);
    host._setDirty(false);
    announceUpdated(host.isConnected, {
      configuration,
      yaml: newYaml,
      basedOn: baseYaml,
      removed: { kind: "component", sectionKey: deletedKey, fromLine },
    });
    // Navigate away only while the user is still here, on the
    // section that was deleted.
    if (host.isConnected && host.sectionKey === deletedKey) {
      fireEvent(host, "section-select", { sectionKey: null });
    }
    notifySuccess(host._localize("device.section_deleted", { name: title }));
  } catch (e) {
    const msg = formatApiError(e, host._localize, "device.section_delete_error");
    host._error = msg;
    // The inline error renders nowhere on an unmounted host; the
    // toast is page-level and survives the teardown.
    notifyError(host._localize("device.section_delete_error"), { description: msg });
  } finally {
    host._deleting = false;
  }
}
