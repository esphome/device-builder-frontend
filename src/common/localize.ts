/**
 * Localization helpers.
 *
 * - Provides a synchronous `defaultLocalize` built from English so the UI
 *   never shows raw keys on first paint.
 * - `loadLocalize()` detects the browser language, loads the matching JSON,
 *   and overlays it on top of the English base (per-key English fallback).
 *
 * Translation files use nested objects; keys are accessed with dot-notation,
 * e.g. `localize("dashboard.title")`.
 */
import enMessages from "../translations/en.json";

export type LocalizeFunc = (
  key: string,
  values?: Record<string, string | number>
) => string;

export const SUPPORTED_LOCALES = ["en", "fr", "nl", "hu"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Language picker choice — every supported locale plus the
 *  "system" pseudo-value that defers to browser detection. */
export type LanguageChoice = SupportedLocale | "system";

/** Single source of truth for the language picker. Consumed by
 *  the settings dialog (wa-select) and the command palette so a
 *  new locale lights up in both pickers from one edit.
 *
 *  Flags are Unicode regional-indicator emoji; on platforms that
 *  ship a flag font (Apple, Android, recent Linux) they render as
 *  the country flag, and on Windows fall back to the two-letter
 *  region code (e.g. "GB", "HU"), which is still a legible cue.
 *  "system" uses the globe emoji to read as "follow the browser". */
export const LANGUAGES: {
  value: LanguageChoice;
  labelKey: string;
  flag: string;
}[] = [
  { value: "system", labelKey: "settings.language_system", flag: "🌐" },
  { value: "en", labelKey: "settings.language_en", flag: "🇬🇧" },
  { value: "fr", labelKey: "settings.language_fr", flag: "🇫🇷" },
  { value: "nl", labelKey: "settings.language_nl", flag: "🇳🇱" },
  { value: "hu", labelKey: "settings.language_hu", flag: "🇭🇺" },
];

const LOCALE_STORAGE_KEY = "esphome-locale";

function detectLocale(): SupportedLocale {
  const lang = navigator.language.split("-")[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(lang)
    ? (lang as SupportedLocale)
    : "en";
}

/** Read the user's explicit locale choice from localStorage, if any. */
export function readStoredLocale(): SupportedLocale | null {
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) {
    return stored as SupportedLocale;
  }
  return null;
}

export function writeStoredLocale(locale: SupportedLocale): void {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}

/** Drop the explicit override so subsequent loads follow the browser. */
export function clearStoredLocale(): void {
  localStorage.removeItem(LOCALE_STORAGE_KEY);
}

/** The active locale: stored override, else browser detection. */
export function activeLocale(): SupportedLocale {
  return readStoredLocale() ?? detectLocale();
}

async function loadLocaleMessages(
  locale: Exclude<SupportedLocale, "en">
): Promise<Record<string, unknown>> {
  switch (locale) {
    case "fr":
      return (await import("../translations/fr.json")).default as Record<string, unknown>;
    case "nl":
      return (await import("../translations/nl.json")).default as Record<string, unknown>;
    case "hu":
      return (await import("../translations/hu.json")).default as Record<string, unknown>;
  }
}

/** Traverse a nested object using a dot-notation key. */
function resolve(obj: Record<string, unknown>, key: string): string | undefined {
  const parts = key.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

function interpolate(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`));
}

/** Deep-merge `override` onto `base`, preserving unoverridden nested keys. */
function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const baseVal = base[key];
    const overrideVal = override[key];
    if (
      typeof baseVal === "object" &&
      baseVal !== null &&
      typeof overrideVal === "object" &&
      overrideVal !== null
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>
      );
    } else {
      result[key] = overrideVal;
    }
  }
  return result;
}

function buildLocalize(messages: Record<string, unknown>): LocalizeFunc {
  return (key, values) => interpolate(resolve(messages, key) ?? key, values);
}

/** Synchronous English fallback — safe to use as an initial context value. */
export const defaultLocalize: LocalizeFunc = buildLocalize(
  enMessages as Record<string, unknown>
);

/**
 * Loads the requested locale (with per-key English fallback) asynchronously.
 * Replace the context value with the result once resolved.
 *
 * If `force` is omitted, picks the stored locale (from a previous user
 * selection) or falls back to the browser locale.
 */
export async function loadLocalize(force?: SupportedLocale): Promise<LocalizeFunc> {
  const locale = force ?? activeLocale();
  if (locale === "en") return defaultLocalize;

  const localeMessages = await loadLocaleMessages(locale);
  return buildLocalize(deepMerge(enMessages as Record<string, unknown>, localeMessages));
}
