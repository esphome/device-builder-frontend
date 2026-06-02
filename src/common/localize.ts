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

// A locale is just a translation-file stem (e.g. "fr", "zh-CN"). The
// concrete set isn't hardcoded — it's whatever JSON files exist in
// src/translations/ at build time (see AVAILABLE_LOCALES below), so
// downloading a new locale lights it up without editing this file.
export type SupportedLocale = string;

/** Language picker choice — any available locale plus the
 *  "system" pseudo-value that defers to browser detection. */
export type LanguageChoice = SupportedLocale | "system";

const BASE_LOCALE = "en";

// Locale codes vary only by separator and case between sources: the web
// platform reports BCP 47 hyphens (`zh-CN`) while Lokalise filenames may
// use underscores (`zh_CN`). Normalize to lowercase hyphenated form for
// comparison so neither side needs a hardcoded per-locale mapping.
const normalizeLocale = (locale: string): string =>
  locale.toLowerCase().replace(/_/g, "-");

const asMessages = (mod: unknown): Record<string, unknown> => {
  if (mod && typeof mod === "object" && "default" in mod) {
    return (mod as { default: Record<string, unknown> }).default;
  }
  return mod as Record<string, unknown>;
};

// Every locale the bundle ships, mapped to its full message object. The
// English base is always present (static import above); the rest come
// from whatever JSON files exist in src/translations/ at build time.
// `import.meta.webpackContext` is a build-time helper: rspack replaces
// the call with a real (synchronous) context factory so each locale's
// name, flag, and strings are available up front for the picker. Under
// vitest the helper doesn't exist and the call throws — we swallow it
// and run English-only, which is also the state in dev before
// translations are downloaded.
function discoverTranslations(): Map<string, Record<string, unknown>> {
  const translations = new Map<string, Record<string, unknown>>([
    [BASE_LOCALE, enMessages as Record<string, unknown>],
  ]);
  try {
    const ctx = import.meta.webpackContext("../translations", {
      recursive: false,
      regExp: /\.json$/,
      mode: "sync",
    });
    for (const key of ctx.keys()) {
      const locale = key.replace(/^\.\//, "").replace(/\.json$/, "");
      if (locale === BASE_LOCALE) continue; // base is the static import
      translations.set(locale, asMessages(ctx(key)));
    }
  } catch {
    // No bundler context (vitest, or pre-download dev) — base only.
  }
  return translations;
}

const TRANSLATIONS = discoverTranslations();

/** Every locale the running bundle can serve: the always-present English
 *  base first, then whatever translation files were downloaded, by code. */
export const AVAILABLE_LOCALES: SupportedLocale[] = [...TRANSLATIONS.keys()].sort(
  (a, b) => {
    if (a === BASE_LOCALE) return -1;
    if (b === BASE_LOCALE) return 1;
    return a.localeCompare(b);
  }
);

/** A choice in the language picker. */
export interface LanguageOption {
  value: LanguageChoice;
  flag: string;
  /** Literal display name — the locale's autonym (e.g. "Français"), read
   *  straight from its translation file. Autonyms read the same in every
   *  UI language, so this is a fixed string, not a localize key. Absent
   *  for the "system" option, which is localized via `labelKey`. */
  label?: string;
  /** Localize key, used only for the "system" option so it reads in the
   *  active UI language. Real locales use the literal `label`. */
  labelKey?: string;
}

/** Single source of truth for the language picker. Consumed by the
 *  settings dialog (wa-select) and the command palette, derived from
 *  whatever locales the bundle actually ships so a downloaded locale
 *  lights up in both pickers with no code change. Each locale's name and
 *  flag come from its own translation file (`language` / `flag` keys),
 *  falling back to the raw code and a placeholder flag if absent.
 *
 *  "system" uses the globe emoji to read as "follow the browser". */
export const LANGUAGES: LanguageOption[] = [
  { value: "system", labelKey: "settings.language_system", flag: "🌐" },
  ...AVAILABLE_LOCALES.map((locale): LanguageOption => {
    const messages = TRANSLATIONS.get(locale) ?? {};
    return {
      value: locale,
      label: typeof messages.language === "string" ? messages.language : locale,
      flag: typeof messages.flag === "string" ? messages.flag : "🏳️",
    };
  }),
];

/** Resolve a picker option's display label: the literal autonym for a
 *  real locale, or the localized name for the "system" pseudo-option. */
export function languageLabel(option: LanguageOption, localize: LocalizeFunc): string {
  return option.label ?? localize(option.labelKey ?? option.value);
}

const LOCALE_STORAGE_KEY = "esphome-locale";

/** Resolve a BCP 47 language tag against a candidate list. An exact
 *  (case-insensitive) match wins so regional variants we ship as
 *  distinct locales (zh-CN vs zh-TW / zh-HK / zh-MO / zh-SG) stay
 *  disambiguated; otherwise fall back to the bare language prefix so
 *  fr-CA / fr-BE resolve to fr, nl-BE to nl, etc. Returns null when
 *  nothing matches. BCP 47 tags are case-insensitive, so a browser may
 *  report `zh-CN`, `zh-cn`, or `ZH-CN` interchangeably. */
export function matchLocale(
  lang: string,
  candidates: readonly string[]
): SupportedLocale | null {
  const target = normalizeLocale(lang);
  const byNormalized = new Map(candidates.map((c) => [normalizeLocale(c), c]));
  const exact = byNormalized.get(target);
  if (exact !== undefined) {
    return exact;
  }
  return byNormalized.get(target.split("-", 1)[0]) ?? null;
}

function detectLocale(): SupportedLocale {
  return matchLocale(navigator.language, AVAILABLE_LOCALES) ?? BASE_LOCALE;
}

/** Read the user's explicit locale choice from localStorage, if any.
 *  A stored locale whose file is no longer in the bundle is ignored so
 *  the loader falls back to detection rather than an empty overlay. */
export function readStoredLocale(): SupportedLocale | null {
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (stored && AVAILABLE_LOCALES.includes(stored)) {
    return stored;
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
 * Loads the requested locale (with per-key English fallback). Async to
 * preserve the call-site contract; the messages are already in memory.
 * Replace the context value with the result once resolved.
 *
 * If `force` is omitted, picks the stored locale (from a previous user
 * selection) or falls back to the browser locale.
 */
export async function loadLocalize(force?: SupportedLocale): Promise<LocalizeFunc> {
  const locale = force ?? activeLocale();
  const localeMessages = TRANSLATIONS.get(locale);
  if (locale === BASE_LOCALE || !localeMessages) return defaultLocalize;

  return buildLocalize(deepMerge(enMessages as Record<string, unknown>, localeMessages));
}
