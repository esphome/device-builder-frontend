/**
 * Resolve a single device-log line to an ESPHome documentation link.
 *
 * Two kinds are produced. ``actionable`` covers curated
 * warnings/errors whose fix lives at a specific page (or that already
 * embed an ``esphome.io`` URL in their text); ``component`` maps the
 * ``[tag:line]`` token to that component's ``/components/<slug>/`` page
 * via the backend-populated integration-docs map. Every URL is passed
 * through ``isSafeDocsUrl`` so a compromised map entry or a spoofed
 * inline URL can't render a ``javascript:`` anchor.
 */
import { isSafeDocsUrl } from "../common/docs.js";
import { stripAnsi } from "./ansi-escapes.js";

export interface ActionableLogDocLink {
  kind: "actionable";
  /** Canonical esphome.io URL, already whitelisted. */
  url: string;
  /** Discriminates the popover copy the renderer localizes. */
  body: "bootloader" | "chip_revision" | "embedded";
}

export interface ComponentLogDocLink {
  kind: "component";
  /** Canonical esphome.io URL, already whitelisted. */
  url: string;
  body: "component";
  /** Resolved component slug (popover title). */
  component: string;
  /** Char range of the tag token within ``clean``. */
  tagRange: { start: number; end: number };
  /** The ANSI-stripped line ``tagRange`` indexes into. */
  clean: string;
}

export type LogDocLink = ActionableLogDocLink | ComponentLogDocLink;

export interface ParsedLogLine {
  level: string;
  tag: string;
  tagStart: number;
  tagEnd: number;
}

/** Curated actionable message → verified docs page. */
interface ActionableEntry {
  level: string;
  tag: string;
  pattern: RegExp;
  url: string;
  body: ActionableLogDocLink["body"];
}

// Verified live against esphome.io (200, anchor present, no redirect).
// Keep this list small and URL-verified; most lines resolve through the
// component map below.
const ACTIONABLE: readonly ActionableEntry[] = [
  {
    level: "W",
    tag: "app",
    pattern: /Bootloader too old for OTA rollback/,
    url: "https://esphome.io/components/ota/esphome/#updating-the-bootloader-on-esp32",
    body: "bootloader",
  },
  {
    level: "W",
    tag: "app",
    pattern: /Set minimum_chip_revision/,
    url: "https://esphome.io/components/esp32/#advanced-configuration",
    body: "chip_revision",
  },
] as const;

/** First ``https://esphome.io`` URL in a line (trailing sentence punctuation
 *  trimmed in ``resolveLogDocLink``). */
const EMBEDDED_URL_RE = /https:\/\/esphome\.io\/[^\s)"']+/;

// A device-log record: [timestamp][LEVEL][tag:line]. Group 1 is the level,
// group 2 the ``tag:line`` token. ESPHome always appends ``:<line>``.
const LOG_LINE_RE = /^\[\d[\d:.]*\]\[([EWICDV]V?)\]\[([^\]]+)\]/;

// Platform-specific tag suffixes (``wifi_esp32`` → ``wifi``). The ``.idf`` /
// ``.arduino`` framework variants use a dot and are handled by the
// before-the-dot split instead.
const PLATFORM_SUFFIX_RE = /_(esp32\w*|esp8266|rp2040|libretiny|lt|host|bk72xx|rtl87xx)$/;

/** Parse level + tag (and the tag's char range) from a clean log line. */
export function parseLogLine(clean: string): ParsedLogLine | undefined {
  const match = clean.match(LOG_LINE_RE);
  if (!match) return undefined;
  const inner = match[2];
  const tag = inner.replace(/:\d+$/, "");
  // match[0] === `[time][LEVEL][` + inner + `]`, so the inner token starts
  // one char before the closing bracket; the tag is inner's leading slice.
  const tagStart = match[0].length - inner.length - 1;
  return { level: match[1], tag, tagStart, tagEnd: tagStart + tag.length };
}

/**
 * Resolve *line* to a documentation link, or ``undefined`` when none
 * applies. *integrationDocs* is the backend ``components/get_integration_docs``
 * map (component name → esphome.io URL); a present entry guarantees the page
 * exists.
 */
export function resolveLogDocLink(
  line: string,
  integrationDocs: Record<string, string>
): LogDocLink | undefined {
  const clean = stripAnsi(line);
  const parsed = parseLogLine(clean);

  if (parsed) {
    for (const entry of ACTIONABLE) {
      if (
        entry.level === parsed.level &&
        entry.tag === parsed.tag &&
        entry.pattern.test(clean) &&
        isSafeDocsUrl(entry.url)
      ) {
        return { kind: "actionable", url: entry.url, body: entry.body };
      }
    }
  }

  const embedded = clean.match(EMBEDDED_URL_RE)?.[0]?.replace(/[.,;:]+$/, "");
  if (embedded && isSafeDocsUrl(embedded)) {
    return { kind: "actionable", url: embedded, body: "embedded" };
  }

  if (parsed) {
    for (const slug of tagCandidates(parsed.tag)) {
      const url = integrationDocs[slug];
      if (url && isSafeDocsUrl(url)) {
        return {
          kind: "component",
          url,
          body: "component",
          component: slug,
          tagRange: { start: parsed.tagStart, end: parsed.tagEnd },
          clean,
        };
      }
    }
  }

  return undefined;
}

/** Ordered component-slug candidates for a log tag. */
function tagCandidates(tag: string): string[] {
  const candidates = [tag];
  const dot = tag.indexOf(".");
  if (dot > 0) candidates.push(tag.slice(0, dot));
  const base = tag.replace(PLATFORM_SUFFIX_RE, "");
  if (base !== tag) candidates.push(base);
  return candidates;
}
