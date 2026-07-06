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

export type LogDocLinkKind = "actionable" | "component";

export interface LogDocLink {
  kind: LogDocLinkKind;
  /** Canonical esphome.io URL, already whitelisted. */
  url: string;
  /** For ``component`` kind: the resolved component slug (popover title). */
  component?: string;
  /** For ``component`` kind: char range of the tag token within the
   *  ANSI-stripped line, so the renderer can wrap just that token. */
  tagRange?: { start: number; end: number };
  /** Discriminates the popover body copy the renderer localizes. */
  body: "bootloader" | "chip_revision" | "embedded" | "component";
}

/** Curated actionable message → verified docs page. */
interface ActionableEntry {
  level: string;
  tag: string;
  pattern: RegExp;
  url: string;
  body: LogDocLink["body"];
}

// Verified live against esphome.io. Both ESP32 messages point at the
// Advanced Configuration section that documents minimum_chip_revision +
// enable_ota_rollback (the "Flash via USB" fix). Keep this list small and
// URL-verified; most lines resolve through the component map below.
const ACTIONABLE: readonly ActionableEntry[] = [
  {
    level: "W",
    tag: "app",
    pattern: /Bootloader too old for OTA rollback/,
    url: "https://esphome.io/components/esp32.html#advanced-configuration",
    body: "bootloader",
  },
  {
    level: "W",
    tag: "app",
    pattern: /Set minimum_chip_revision/,
    url: "https://esphome.io/components/esp32.html#advanced-configuration",
    body: "chip_revision",
  },
] as const;

// Strips every ANSI escape sequence in either the real ``\x1b`` form or the
// literal ``\033`` text ESPHome's dashboard formatter emits (see ansi-log's
// ANSI_ESCAPE_RE for the full rationale). Global so ``replace`` clears all.
const ANSI_STRIP_RE =
  /(?:\x1b|\\033)\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]|(?:\x1b|\\033)\][^\x07\x1b]*(?:\x07|\x1b\\|\\033\\)|(?:\x1b|\\033)[NOPVWX^_=>]/g;

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

/** Strip every ANSI escape sequence from a log line. */
export function stripLogAnsi(line: string): string {
  return line.replace(ANSI_STRIP_RE, "");
}

interface ParsedLine {
  level: string;
  tag: string;
  tagStart: number;
  tagEnd: number;
}

/** Parse level + tag (and the tag's char range) from a clean log line. */
function parseLogLine(clean: string): ParsedLine | undefined {
  const match = clean.match(LOG_LINE_RE);
  if (!match) return undefined;
  const inner = match[2];
  const tag = inner.replace(/:\d+$/, "");
  // match[0] === `[time][LEVEL][` + inner + `]`, so the inner token starts
  // one char before the closing bracket; the tag is inner's leading slice.
  const tagStart = match[0].length - inner.length - 1;
  return { level: match[1], tag, tagStart, tagEnd: tagStart + tag.length };
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
  const clean = stripLogAnsi(line);
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
          component: slug,
          tagRange: { start: parsed.tagStart, end: parsed.tagEnd },
          body: "component",
        };
      }
    }
  }

  return undefined;
}
