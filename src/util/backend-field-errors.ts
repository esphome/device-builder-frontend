/**
 * Resolve backend validation errors onto visual-editor targets.
 *
 * The linter ships each mappable error as a 1-indexed line plus the key
 * chain at the error's location (see MappedValidationError). This module
 * turns those into section instances (for navigator badges) and
 * section-relative field paths (for inline form errors), reusing the same
 * section and path conventions the YAML-cursor sync uses.
 */
import type { ValidationError } from "./config-validation.js";
import { LIST_SECTIONS } from "./section-entry-overrides.js";
import type { MappedValidationError } from "./yaml-lint-backend.js";
import { sectionForCursor, sectionKeyOf } from "./yaml-sections.js";

/** A validation error pinned on a section instance and (optionally) a field. */
export interface BackendFieldError {
  sectionKey: string;
  /** 1-indexed first line of the section instance the error belongs to. */
  fromLine: number;
  /** Dotted section-relative field path; empty when only the section resolved. */
  relPath: string;
  message: string;
}

/**
 * The form-field path for a document key path, or [] when the location
 * has no form field to carry a message.
 *
 * Drops the top-level key (LIST_SECTIONS like globals keep it — their
 * form keys fields under the section key). A remainder that doesn't end
 * in a key names a section header, instance, or list item rather than a
 * field, so it reduces to [].
 */
export function formRelativePath<T extends string | number>(full: readonly T[]): T[] {
  const top = full[0];
  const rel =
    full.length > 1 && typeof top === "string" && LIST_SECTIONS.has(top)
      ? [...full]
      : full.slice(1);
  return typeof rel[rel.length - 1] === "string" ? rel : [];
}

/**
 * Pin each mapped error on a section instance in the current buffer.
 *
 * The result is the deduped set of user-visible errors: one per field
 * path (the form renders a single message per field) and one per message
 * for section-level errors (the banner shows each distinct message
 * once), so every consumer — badge counts, form maps, jump affordances —
 * agrees on what exists.
 */
export function resolveBackendErrors(
  yaml: string,
  mapped: readonly MappedValidationError[]
): BackendFieldError[] {
  const out: BackendFieldError[] = [];
  const seen = new Set<string>();
  for (const err of mapped) {
    const section = sectionForCursor(yaml, err.line, err.keyPath);
    if (!section) continue;
    let rel = formRelativePath(err.keyPath);
    // An expanded list instance (- platform: dht) IS the form's root: the
    // navigator already picked the item by fromLine, so the domain-list
    // index the key path carries is redundant — drop it. Nested list
    // indices (esphome.areas.0.id) stay; the form paths carry them.
    if (section.parentKey !== undefined && typeof rel[0] === "number") {
      rel = rel.slice(1);
    }
    const sectionKey = sectionKeyOf(section);
    const relPath = rel.join(".");
    const visibleKey = `${instanceKey(sectionKey, section.fromLine)}:${
      relPath || `message:${err.message}`
    }`;
    if (seen.has(visibleKey)) continue;
    seen.add(visibleKey);
    out.push({
      sectionKey,
      fromLine: section.fromLine,
      relPath,
      message: err.message,
    });
  }
  return out;
}

/** Stable per-instance key — two sensor.dht items differ only by fromLine. */
export function instanceKey(sectionKey: string, fromLine: number): string {
  return `${sectionKey}@${fromLine}`;
}

/** Error count per section instance, keyed by instanceKey. The resolve
 *  step already deduped to the visible set, so the badge matches what the
 *  form and banner render. */
export function backendErrorCounts(
  errors: readonly BackendFieldError[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of errors) {
    const key = instanceKey(e.sectionKey, e.fromLine);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * The selected section instance's errors as the path-keyed map the config
 * form renders. Section-level errors (empty relPath) are navigator/banner
 * material, not field errors. An undefined fromLine matches any instance
 * of the section key.
 */
export function backendErrorsForSection(
  errors: readonly BackendFieldError[],
  sectionKey: string | null,
  fromLine: number | undefined
): Map<string, ValidationError> {
  const out = new Map<string, ValidationError>();
  if (!sectionKey) return out;
  for (const e of errors) {
    if (e.sectionKey !== sectionKey) continue;
    if (fromLine !== undefined && e.fromLine !== fromLine) continue;
    if (!e.relPath) continue;
    out.set(e.relPath, {
      key: e.relPath,
      code: "validation.backend",
      params: { message: e.message },
    });
  }
  return out;
}
