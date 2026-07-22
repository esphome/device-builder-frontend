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
 * A mapped error's section-relative form path. A scalar list item's
 * trailing index maps to a renderable row (``field.0``, the per-item
 * keys the list renderer reads, #1354), so it survives the reduction;
 * mapping-item tails still reduce to [] (banner material).
 */
export function mappedFormPath(
  err: Pick<MappedValidationError, "keyPath" | "scalarItemTail">
): (string | number)[] {
  const rel = formRelativePath(err.keyPath);
  if (rel.length > 0 || !err.scalarItemTail) return rel;
  const parent = formRelativePath(err.keyPath.slice(0, -1));
  return parent.length > 0 ? [...parent, err.keyPath[err.keyPath.length - 1]] : [];
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
    let rel = mappedFormPath(err);
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

/** A section instance's errors, partitioned for the section editor. */
export interface InstanceBackendErrors {
  /** Field-mapped errors as the path-keyed map the config form renders. */
  fields: Map<string, ValidationError>;
  /** Raw messages of the field-mapped errors, for sections with no form. */
  fieldMessages: string[];
  /** Section-level messages (empty relPath) — banner material. */
  sectionMessages: string[];
}

/** Shared empty value, so unwired consumers keep a stable identity. */
export const NO_INSTANCE_ERRORS: InstanceBackendErrors = {
  fields: new Map(),
  fieldMessages: [],
  sectionMessages: [],
};

/**
 * The selected section instance's errors, partitioned once for every
 * consumer in the section editor. An undefined fromLine matches any
 * instance of the section key.
 */
export function backendErrorsForInstance(
  errors: readonly BackendFieldError[],
  sectionKey: string | null,
  fromLine: number | undefined
): InstanceBackendErrors {
  if (!sectionKey) return NO_INSTANCE_ERRORS;
  const fields = new Map<string, ValidationError>();
  const fieldMessages: string[] = [];
  const sectionMessages: string[] = [];
  for (const e of errors) {
    if (e.sectionKey !== sectionKey) continue;
    if (fromLine !== undefined && e.fromLine !== fromLine) continue;
    if (!e.relPath) {
      sectionMessages.push(e.message);
      continue;
    }
    fieldMessages.push(e.message);
    fields.set(e.relPath, {
      key: e.relPath,
      code: "validation.backend",
      params: { message: e.message },
    });
  }
  return { fields, fieldMessages, sectionMessages };
}
