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
import { IntlMessageFormat } from "intl-messageformat";

import languageManifest from "../generated/language-manifest.json";
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

interface LanguageMeta {
  language: string;
  flag: string;
  /** Percentage (0–100) of English source keys this locale has translated,
   *  precomputed at build time (untranslated keys fall back to English). */
  completeness: number;
}

// Build-time manifest of every shipped locale's autonym, flag, and
// translation completeness, generated from src/translations/*.json by
// build-scripts/gen-language-manifest.cjs. It carries only those few scalar
// keys per locale, so it's cheap to keep in the entry bundle — which lets the
// language picker stay synchronous (see LANGUAGES / AVAILABLE_LOCALES below)
// without pulling any locale's message body into the initial download. The
// bodies load lazily instead (see getLocaleContext).
const LANGUAGE_MANIFEST = languageManifest as Record<string, LanguageMeta>;

// Locale message bodies load lazily — `mode: "lazy"` makes rspack emit one
// async chunk per locale, fetched only when that locale is selected (see
// loadLocalize). English-only users download none of them.
// `import.meta.webpackContext` is a build-time helper rspack replaces with a
// real context factory; under vitest it doesn't exist and the call throws.
// The context is created lazily and memoized so module evaluation never
// touches it (and the guard is scoped to just the feature-probing call, so a
// genuine load failure later surfaces rather than being swallowed here).
let localeContext: ReturnType<ImportMeta["webpackContext"]> | null | undefined;
function getLocaleContext(): ReturnType<ImportMeta["webpackContext"]> | null {
  if (localeContext !== undefined) return localeContext;
  try {
    localeContext = import.meta.webpackContext("../translations", {
      recursive: false,
      regExp: /\.json$/,
      mode: "lazy",
    });
  } catch {
    // No bundler context (vitest, or pre-download dev).
    localeContext = null;
  }
  return localeContext;
}

/** Every locale the running bundle can serve: the always-present English
 *  base first, then whatever translation files were downloaded, by code.
 *  Derived from the build-time language manifest (autonym + flag per locale)
 *  so the picker is data-driven and synchronous without bundling any message
 *  body — a downloaded locale lights up here with no code change. */
export const AVAILABLE_LOCALES: SupportedLocale[] = Object.keys(LANGUAGE_MANIFEST).sort(
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
  /** Percentage (0–100) of English source keys this locale has translated.
   *  Absent for the "system" option, which has no single underlying locale. */
  completeness?: number;
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
    const meta = LANGUAGE_MANIFEST[locale];
    return {
      value: locale,
      label: meta?.language ?? locale,
      flag: meta?.flag ?? "🏳️",
      completeness: meta?.completeness ?? 0,
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
  invalidateActiveLocale();
}

/** Drop the explicit override so subsequent loads follow the browser. */
export function clearStoredLocale(): void {
  localStorage.removeItem(LOCALE_STORAGE_KEY);
  invalidateActiveLocale();
}

// Memoized: activeLocale() sits on 1Hz-and-faster render paths (timer
// readouts re-render per streamed log line), and an uncached resolve pays a
// localStorage read plus matchLocale's per-candidate normalization each call.
let cachedActiveLocale: SupportedLocale | null = null;

function invalidateActiveLocale(): void {
  cachedActiveLocale = null;
}

// Browser-language and cross-tab locale changes invalidate too (a storage
// event's null key is a full clear); same-tab writes go through
// write/clearStoredLocale below.
if (typeof window !== "undefined") {
  window.addEventListener("languagechange", invalidateActiveLocale);
  window.addEventListener("storage", (e) => {
    if (e.key === LOCALE_STORAGE_KEY || e.key === null) invalidateActiveLocale();
  });
}

/** The active locale: stored override, else browser detection. */
export function activeLocale(): SupportedLocale {
  cachedActiveLocale ??= readStoredLocale() ?? detectLocale();
  return cachedActiveLocale;
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

// Matches an ICU formatter/selector argument — `{n, plural ...}`,
// `{x, select ...}`, `{v, number}`, etc. Deliberately does NOT match a bare
// `{placeholder}`, so simple strings (and English copy with apostrophes,
// which ICU treats as an escape char) never reach the ICU parser.
const ICU_PATTERN = /\{\s*\w+\s*,\s*(?:plural|selectordinal|select|number|date|time)\b/;

// Compiled message formatters cached per locale+template. Compilation is the
// expensive step; format() is cheap.
const icuCache = new Map<string, IntlMessageFormat>();

function formatICU(
  template: string,
  locale: string,
  values?: Record<string, string | number>
): string {
  const cacheKey = `${locale} ${template}`;
  try {
    let mf = icuCache.get(cacheKey);
    if (!mf) {
      mf = new IntlMessageFormat(template, locale);
      icuCache.set(cacheKey, mf);
    }
    const out = mf.format(values);
    return Array.isArray(out) ? out.join("") : String(out);
  } catch {
    // Malformed ICU or a missing required argument — degrade to the raw
    // template rather than crash the render.
    return template;
  }
}

function interpolate(
  template: string,
  locale: string,
  values?: Record<string, string | number>
): string {
  if (ICU_PATTERN.test(template)) return formatICU(template, locale, values);
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

function buildLocalize(messages: Record<string, unknown>, locale: string): LocalizeFunc {
  return (key, values) => interpolate(resolve(messages, key) ?? key, locale, values);
}

/** Synchronous English fallback — safe to use as an initial context value. */
export const defaultLocalize: LocalizeFunc = buildLocalize(
  enMessages as Record<string, unknown>,
  BASE_LOCALE
);

/**
 * Loads the requested locale (with per-key English fallback). Fetches the
 * locale's own lazily-split chunk on demand, so non-English bodies stay out
 * of the entry bundle. Replace the context value with the result once
 * resolved.
 *
 * If `force` is omitted, picks the stored locale (from a previous user
 * selection) or falls back to the browser locale.
 */
export async function loadLocalize(force?: SupportedLocale): Promise<LocalizeFunc> {
  const locale = force ?? activeLocale();
  if (locale === BASE_LOCALE) return defaultLocalize;

  const ctx = getLocaleContext();
  if (!ctx) return defaultLocalize; // vitest, or pre-download dev — English only.

  let mod: unknown;
  try {
    // Lazy context: this resolves (and fetches) the locale's own async chunk.
    mod = await (ctx(`./${locale}.json`) as Promise<unknown>);
  } catch {
    // Locale file not in the bundle (e.g. a stored locale that's no longer
    // shipped) or its chunk failed to load — fall back to English rather
    // than render raw keys.
    return defaultLocalize;
  }
  return buildLocalize(
    deepMerge(enMessages as Record<string, unknown>, asMessages(mod)),
    normalizeLocale(locale)
  );
}
