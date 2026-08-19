/** Phrasing for the config-migration nudge: one sentence per ``MigrationChange``. */
import { html, type TemplateResult } from "lit";
import type { MigrationChange } from "../../api/types/editor.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { releaseLine } from "../../util/version-mismatch.js";

/** A run of a sentence: plain prose, or a config spelling to set in code. */
export type MigrationCopySegment = string | { code: string };

// Markers wrapped around each config spelling before localisation, so the
// translated sentence can be split back into prose and code runs.
const CODE_OPEN = "\u0001";
const CODE_CLOSE = "\u0002";
const CODE_RUN_RE = /\u0001([^\u0002]*)\u0002/g;

/** The sentence describing *change* (with its removal / required note) as prose and code runs. */
export function migrationChangeSegments(
  localize: LocalizeFunc,
  change: MigrationChange
): MigrationCopySegment[] {
  const code = (value: string) => `${CODE_OPEN}${value}${CODE_CLOSE}`;
  let sentence = localize(`device.config_migration_change_${change.kind}`, {
    old: code(change.old),
    new: code(change.new),
    scope: code(change.scope),
  });
  const since = change.since ? releaseLine(change.since) : null;
  const removedIn = change.removed_in ? releaseLine(change.removed_in) : null;
  if (since !== null && removedIn !== null && !change.required) {
    sentence += ` ${localize("device.config_migration_change_since_removed_in", {
      version: since,
      removed_in: removedIn,
    })}`;
  } else if (since !== null) {
    sentence += ` ${localize("device.config_migration_change_since", { version: since })}`;
  } else if (removedIn !== null && !change.required) {
    sentence += ` ${localize("device.config_migration_change_removed_in", {
      removed_in: removedIn,
    })}`;
  }
  if (change.required) {
    sentence += ` ${localize("device.config_migration_change_required")}`;
  }
  const segments: MigrationCopySegment[] = [];
  let last = 0;
  for (const match of sentence.matchAll(CODE_RUN_RE)) {
    if (match.index > last) segments.push(sentence.slice(last, match.index));
    segments.push({ code: match[1] });
    last = match.index + match[0].length;
  }
  if (last < sentence.length) segments.push(sentence.slice(last));
  return segments;
}

/** Render the sentence for *change*, config spellings set in ``<code>``. */
export function describeMigrationChange(
  localize: LocalizeFunc,
  change: MigrationChange
): TemplateResult {
  return html`${migrationChangeSegments(localize, change).map((segment) =>
    typeof segment === "string" ? segment : html`<code>${segment.code}</code>`
  )}`;
}
