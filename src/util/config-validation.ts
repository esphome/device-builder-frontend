import type { ConfigEntry } from "../api/types.js";
import { ConfigEntryType } from "../api/types.js";

export interface ValidationError {
  key: string;
  code: string;
  params?: Record<string, string | number>;
}

const DEVICE_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function validateDeviceName(name: string): ValidationError | null {
  const trimmed = name.trim();
  if (!trimmed) return { key: "name", code: "validation.required" };
  if (trimmed.length > 63) {
    return { key: "name", code: "validation.max_length", params: { max: 63 } };
  }
  if (!DEVICE_NAME_RE.test(trimmed)) {
    return { key: "name", code: "validation.invalid_device_name" };
  }
  return null;
}

export function validateEntry(
  entry: ConfigEntry,
  raw: unknown,
): ValidationError | null {
  if (entry.hidden) return null;

  const isEmpty =
    raw === undefined ||
    raw === null ||
    (typeof raw === "string" && raw.trim() === "") ||
    (Array.isArray(raw) && raw.length === 0);

  if (entry.required && isEmpty) {
    return { key: entry.key, code: "validation.required" };
  }
  if (isEmpty) return null;

  if (entry.type === ConfigEntryType.INTEGER || entry.type === ConfigEntryType.FLOAT) {
    const num = typeof raw === "number" ? raw : Number(String(raw));
    if (Number.isNaN(num)) {
      return { key: entry.key, code: "validation.not_a_number" };
    }
    if (entry.type === ConfigEntryType.INTEGER && !Number.isInteger(num)) {
      return { key: entry.key, code: "validation.not_an_integer" };
    }
    if (entry.range) {
      const [min, max] = entry.range;
      if (num < min) {
        return { key: entry.key, code: "validation.min", params: { min } };
      }
      if (num > max) {
        return { key: entry.key, code: "validation.max", params: { max } };
      }
    }
  }

  if (entry.type === ConfigEntryType.SELECT && entry.options) {
    const allowed = entry.options.map((o) => o.value);
    if (!allowed.includes(String(raw))) {
      return { key: entry.key, code: "validation.invalid_option" };
    }
  }

  return null;
}

export function validateEntries(
  entries: ConfigEntry[],
  values: Record<string, unknown>,
): Map<string, ValidationError> {
  const errors = new Map<string, ValidationError>();
  for (const entry of entries) {
    const raw = values[entry.key] ?? entry.default_value;
    const err = validateEntry(entry, raw);
    if (err) errors.set(entry.key, err);
  }
  return errors;
}
