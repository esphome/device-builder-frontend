/**
 * Resolve a single device-log line to its ESPHome documentation links.
 *
 * A line carries up to two independent facets. ``actionable`` covers
 * curated warnings/errors whose fix lives at a specific page (or that
 * already embed an ``esphome.io`` URL in their text); ``component``
 * maps the ``[tag:line]`` token to that component's docs page via the
 * backend-populated integration-docs map. A crash banner has both — the
 * icon links the fix, the tag links the platform. Every URL is passed
 * through ``isSafeDocsUrl`` so a compromised map entry or a spoofed
 * inline URL can't render a ``javascript:`` anchor.
 */
import type { IntegrationDoc } from "../api/types/components.js";
import { isSafeDocsUrl } from "../common/docs.js";
import { stripAnsi } from "./ansi-escapes.js";
import { parseLogLine } from "./log-line.js";

export interface ActionableLogDocLink {
  kind: "actionable";
  /** Canonical esphome.io URL, already whitelisted. */
  url: string;
  /** Discriminates the popover copy the renderer localizes. */
  body:
    | "ble_slots"
    | "boot_loop"
    | "bootloader"
    | "chip_revision"
    | "crash"
    | "embedded"
    | "nvs"
    | "ota_rollback"
    | "slow_component"
    | "sram1_as_iram"
    | "wifi_ap_no_portal"
    | "wifi_reconnect";
}

export interface ComponentLogDocLink {
  kind: "component";
  /** Canonical esphome.io URL, already whitelisted. */
  url: string;
  body: "component";
  /** Resolved component slug (the map key that matched). */
  component: string;
  /** Catalog display name ("Ethernet Component") — the popover title. */
  displayName: string;
  /** First sentence of the catalog description — the popover body. */
  description: string;
  /** Char range of the tag token within ``clean``. */
  tagRange: { start: number; end: number };
  /** The ANSI-stripped line ``tagRange`` indexes into. */
  clean: string;
}

export type LogDocLink = ActionableLogDocLink | ComponentLogDocLink;

/** The independent doc-link facets one log line can carry. */
export interface LogDocLinks {
  actionable?: ActionableLogDocLink;
  component?: ComponentLogDocLink;
  /** Log level of a parsed line, so the renderer colours annotated lines
   *  without re-running the line regex every frame. */
  level?: string;
}

/** Curated actionable message → verified docs page. */
interface ActionableEntry {
  level: string;
  /** Emitting log tags, verified against the esphome source. */
  tags: readonly string[];
  pattern: RegExp;
  url: string;
  body: ActionableLogDocLink["body"];
}

const ESP32_ADVANCED_URL = "https://esphome.io/components/esp32/#advanced-configuration";
const TROUBLESHOOTING_URL = "https://esphome.io/guides/troubleshooting/";

// Verified live against esphome.io (200, anchor present, no redirect).
// Keep this list small and URL-verified; most lines resolve through the
// component map below.
const ACTIONABLE: readonly ActionableEntry[] = [
  {
    level: "W",
    tags: ["app"],
    pattern: /Bootloader too old for OTA rollback/,
    url: "https://esphome.io/components/ota/esphome/#updating-the-bootloader-on-esp32",
    body: "bootloader",
  },
  {
    level: "W",
    tags: ["app"],
    pattern: /Set minimum_chip_revision/,
    url: ESP32_ADVANCED_URL,
    body: "chip_revision",
  },
  {
    level: "W",
    tags: ["app"],
    pattern: /Set sram1_as_iram/,
    url: ESP32_ADVANCED_URL,
    body: "sram1_as_iram",
  },
  {
    level: "E",
    // One crash handler per platform, each logging under its own tag.
    tags: ["esp32.crash", "esp8266", "rp2040.crash"],
    pattern: /CRASH DETECTED ON PREVIOUS BOOT/,
    url: TROUBLESHOOTING_URL,
    body: "crash",
  },
  {
    // core/component.cpp — the ``component`` tag has no docs page, so
    // these lines get no link at all without this entry.
    level: "W",
    tags: ["component"],
    pattern: /took a long time for an operation/,
    url: `${TROUBLESHOOTING_URL}#took-a-long-time-for-an-operation-warning`,
    body: "slow_component",
  },
  {
    // The W level excludes the benign "Station Roaming" variant (emitted
    // at INFO with an early return in wifi_component_esp_idf.cpp); the
    // lookahead keeps it excluded even if that level ever changes.
    level: "W",
    tags: ["wifi"],
    pattern: /Connection lost; reconnecting|Disconnected ssid=(?!.*Station Roaming)/,
    url: "https://esphome.io/guides/faq/#my-node-keeps-reconnecting-randomly",
    body: "wifi_reconnect",
  },
  {
    level: "W",
    tags: ["safe_mode"],
    pattern: /Last reset too quick/,
    url: TROUBLESHOOTING_URL,
    body: "boot_loop",
  },
  {
    level: "W",
    tags: ["safe_mode"],
    pattern: /OTA rollback detected/,
    url: TROUBLESHOOTING_URL,
    body: "ota_rollback",
  },
  {
    level: "W",
    tags: ["preferences"],
    pattern: /nvs_open failed/,
    url: "https://esphome.io/guides/faq/#component-states-not-restored-after-reboot",
    body: "nvs",
  },
  {
    level: "W",
    tags: ["bluetooth_proxy"],
    pattern: /No free connections available/,
    url: "https://esphome.io/components/bluetooth_proxy/#how-active-connections-work",
    body: "ble_slots",
  },
] as const;

// Tag-keyed index so the per-line check is one Map miss for the vast
// majority of tags, with zero regex work. URLs are static, so the safety
// gate runs once here instead of per line; an entry that ever failed it
// would simply never be indexed.
const ACTIONABLE_BY_TAG = new Map<string, ActionableEntry[]>();
for (const entry of ACTIONABLE) {
  if (!isSafeDocsUrl(entry.url)) continue;
  for (const tag of entry.tags) {
    const bucket = ACTIONABLE_BY_TAG.get(tag);
    if (bucket) bucket.push(entry);
    else ACTIONABLE_BY_TAG.set(tag, [entry]);
  }
}

/** Curated actionable message emitted by the esphome CLI (config /
 *  compile / logs validation phase), not the firmware. These lines are
 *  ``<LEVEL> <message>`` with no ``[tag:line]`` token, so they can't
 *  key off the tag index above. */
interface ActionableCliEntry {
  /** CLI level word as printed by ``ESPHomeLogFormatter``. */
  level: "WARNING" | "ERROR";
  pattern: RegExp;
  url: string;
  body: ActionableLogDocLink["body"];
}

// Verified live against esphome.io (200, no redirect). Kept small and
// URL-verified, same bar as ``ACTIONABLE`` above.
const ACTIONABLE_CLI: readonly ActionableCliEntry[] = (
  [
    {
      // wifi/__init__.py final_validate: an ``ap:`` with no captive_portal
      // or web_server can't serve its config page.
      level: "WARNING",
      pattern: /AP is configured but neither captive_portal nor web_server/,
      url: "https://esphome.io/components/captive_portal/",
      body: "wifi_ap_no_portal",
    },
  ] satisfies readonly ActionableCliEntry[]
).filter((entry) => isSafeDocsUrl(entry.url));

// CLI log record: ``<LEVEL> <message>`` (optionally a leading timestamp).
// Group 1 is the level word; the message follows, matched by pattern.
const CLI_LINE_RE = /^(?:[\d:.\s-]*\s)?(WARNING|ERROR)\s/;

// The CLI level word maps to the same single-letter level the firmware
// lines carry, so a matched CLI line colours its icon like the firmware
// path (``links.level`` -> ``LOG_LEVEL_COLORS`` in the renderer).
const CLI_LEVEL_LETTER: Record<ActionableCliEntry["level"], string> = {
  WARNING: "W",
  ERROR: "E",
};

/** First ``https://esphome.io`` URL in a line (trailing sentence punctuation
 *  trimmed in ``resolveLogDocLink``). */
const EMBEDDED_URL_RE = /https:\/\/esphome\.io\/[^\s)"']+/;

// Platform-specific tag suffixes, limited to the ones the esphome tree
// actually emits (``wifi_esp32`` / ``wifi_esp8266`` / ``wifi_lt``). The
// ``.idf`` / ``.arduino`` framework variants use a dot and are handled by
// the before-the-dot split instead.
const PLATFORM_SUFFIX_RE = /_(esp32\w*|esp8266|lt)$/;

/**
 * Resolve *line* to its documentation links, or ``undefined`` when none
 * apply. The two facets are independent — a curated warning on a
 * catalogued tag carries both. *integrationDocs* is the backend
 * ``components/get_integration_docs`` map (component name → docs URL,
 * display name, and trimmed description); a present entry guarantees
 * the page exists.
 */
export function resolveLogDocLink(
  line: string,
  integrationDocs: Record<string, IntegrationDoc>
): LogDocLinks | undefined {
  const clean = stripAnsi(line);
  const parsed = parseLogLine(clean);

  let actionable: ActionableLogDocLink | undefined;
  if (parsed) {
    for (const entry of ACTIONABLE_BY_TAG.get(parsed.tag) ?? []) {
      if (entry.level === parsed.level && entry.pattern.test(clean)) {
        actionable = { kind: "actionable", url: entry.url, body: entry.body };
        break;
      }
    }
  }
  // CLI validation lines (``WARNING <msg>``) carry no tag, so they miss
  // the firmware parse above; match them on the level word + message.
  let cliLevel: string | undefined;
  if (!actionable) {
    const cli = clean.match(CLI_LINE_RE);
    if (cli) {
      for (const entry of ACTIONABLE_CLI) {
        if (entry.level === cli[1] && entry.pattern.test(clean)) {
          actionable = { kind: "actionable", url: entry.url, body: entry.body };
          cliLevel = CLI_LEVEL_LETTER[entry.level];
          break;
        }
      }
    }
  }
  // The pattern opens on a literal prefix, so the engine's scan for a
  // non-matching line is as cheap as a substring search; the extracted
  // URL is then host-gated by isSafeDocsUrl.
  if (!actionable) {
    const embedded = clean.match(EMBEDDED_URL_RE)?.[0]?.replace(/[.,;:]+$/, "");
    if (embedded && isSafeDocsUrl(embedded)) {
      actionable = { kind: "actionable", url: embedded, body: "embedded" };
    }
  }

  let component: ComponentLogDocLink | undefined;
  if (parsed) {
    for (const slug of tagCandidates(parsed.tag)) {
      // Own-property check: the tag is untrusted log text, and a bare
      // index read would surface prototype members for e.g. "constructor".
      const entry = Object.prototype.hasOwnProperty.call(integrationDocs, slug)
        ? integrationDocs[slug]
        : undefined;
      if (entry && isSafeDocsUrl(entry.url)) {
        component = {
          kind: "component",
          url: entry.url,
          body: "component",
          component: slug,
          displayName: entry.name,
          description: entry.description,
          tagRange: { start: parsed.tagStart, end: parsed.tagEnd },
          clean,
        };
        break;
      }
    }
  }

  if (!actionable && !component) return undefined;
  // Assign facets conditionally so an absent one is truly absent —
  // no enumerable ``undefined`` keys to trip deep-equality or ``in``.
  const links: LogDocLinks = {};
  if (actionable) links.actionable = actionable;
  if (component) links.component = component;
  if (parsed) links.level = parsed.level;
  else if (cliLevel) links.level = cliLevel;
  return links;
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
