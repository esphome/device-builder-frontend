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
 * Drop the top-level key to get the form-relative path. LIST_SECTIONS
 * (globals) are the exception: their form keys fields under the section
 * key, so keep it — but only with a child segment; a bare section header
 * reduces to [] (a non-field location), not a whole-section field path.
 */
export function formRelativePath(full: readonly string[]): string[] {
  return full.length > 1 && LIST_SECTIONS.has(full[0]) ? [...full] : full.slice(1);
}

/** Pin each mapped error on a section instance in the current buffer. */
export function resolveBackendErrors(
  yaml: string,
  mapped: readonly MappedValidationError[]
): BackendFieldError[] {
  const out: BackendFieldError[] = [];
  for (const err of mapped) {
    const section = sectionForCursor(yaml, err.line, err.keyPath);
    if (!section) continue;
    out.push({
      sectionKey: sectionKeyOf(section),
      fromLine: section.fromLine,
      relPath: formRelativePath(err.keyPath).join("."),
      message: err.message,
    });
  }
  return out;
}

/** Stable per-instance key — two sensor.dht items differ only by fromLine. */
export function instanceKey(sectionKey: string, fromLine: number): string {
  return `${sectionKey}@${fromLine}`;
}

/** Error count per section instance, keyed by instanceKey. */
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
 * form renders. First error per path wins; section-level errors (empty
 * relPath) are navigator/banner material, not field errors. An undefined
 * fromLine matches any instance of the section key.
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
    if (!e.relPath || out.has(e.relPath)) continue;
    out.set(e.relPath, {
      key: e.relPath,
      code: "validation.backend",
      params: { message: e.message },
    });
  }
  return out;
}
