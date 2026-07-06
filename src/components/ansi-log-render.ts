/**
 * Line-rendering helpers for ``ansi-log``.
 *
 * Holds the ANSI span → template mapping plus the two doc-annotated line
 * shapes (a curated/embedded ``actionable`` line with a trailing info icon,
 * and a ``component`` line whose ``[tag:line]`` token becomes a quiet link).
 * The affordances keep the copy buffer clean — the icon is
 * ``user-select: none`` outside the text run, and the tag button stays
 * inline with ``user-select: text`` — so a multi-line drag-select still
 * copies clean log text.
 */
import { mdiInformation } from "@mdi/js";
import { css, html, nothing, type TemplateResult } from "lit";
import type { LocalizeFunc } from "../common/localize.js";
import type {
  ActionableLogDocLink,
  ComponentLogDocLink,
  LogDocLink,
} from "../util/log-doc-links.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ information: mdiInformation });

/** Styles for the annotated line shapes; spread into ansi-log's shadow DOM. */
export const logDocLinkStyles = css`
  /* Actionable line: text keeps pre-wrap in its own column so the icon can
     sit in the right margin without joining the selectable text. The icon
     stays at the fixed right edge so warnings share one scannable column;
     colour + brightness (below) make it read as part of the line. */
  .log-line--doc {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  .log-line-text {
    flex: 1 1 auto;
    min-width: 0;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  .log-doc-icon {
    flex: 0 0 auto;
    /* Kept out of the copy buffer so a multi-line drag-select stays clean. */
    user-select: none;
    -webkit-user-select: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: 0;
    border: none;
    background: none;
    /* Inherits the line's level colour from the container; brightness
       lifts it above the message text so the fixed right-margin column
       stays noticeable. */
    color: inherit;
    font-size: 16px;
    line-height: 1;
    filter: brightness(1.35);
    cursor: pointer;
  }

  .log-doc-icon:hover,
  .log-doc-icon:focus-visible {
    filter: brightness(1.7);
  }

  /* Component tag link stays inline text (still selectable/copyable) so it
     doesn't disturb drag-select; only the dotted underline marks it. */
  .log-tag-link {
    display: inline;
    margin: 0;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
    user-select: text;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
  }

  .log-tag-link:hover,
  .log-tag-link:focus-visible {
    text-decoration-style: solid;
  }
`;

export interface AnsiSpan {
  text: string;
  color?: string;
  bgColor?: string;
  bold?: boolean;
  dim?: boolean;
}

/** Click handler wiring a trigger element back to the host popover. */
export type OpenDocHandler = (e: MouseEvent, link: LogDocLink) => void;

/** Localized popover copy for a resolved doc link. */
export interface LogDocPopoverText {
  heading: string;
  body: string;
  linkLabel: string;
}

// en.json keys for each curated/embedded popover body.
const CURATED_COPY: Record<
  ActionableLogDocLink["body"],
  { title: string; body: string }
> = {
  bootloader: {
    title: "dashboard.logs_doc_bootloader_title",
    body: "dashboard.logs_doc_bootloader_body",
  },
  chip_revision: {
    title: "dashboard.logs_doc_chip_revision_title",
    body: "dashboard.logs_doc_chip_revision_body",
  },
  crash: {
    title: "dashboard.logs_doc_crash_title",
    body: "dashboard.logs_doc_crash_body",
  },
  sram1_as_iram: {
    title: "dashboard.logs_doc_sram1_title",
    body: "dashboard.logs_doc_sram1_body",
  },
  embedded: {
    title: "dashboard.logs_doc_embedded_title",
    body: "dashboard.logs_doc_embedded_body",
  },
  slow_component: {
    title: "dashboard.logs_doc_slow_component_title",
    body: "dashboard.logs_doc_slow_component_body",
  },
  wifi_reconnect: {
    title: "dashboard.logs_doc_wifi_reconnect_title",
    body: "dashboard.logs_doc_wifi_reconnect_body",
  },
  boot_loop: {
    title: "dashboard.logs_doc_boot_loop_title",
    body: "dashboard.logs_doc_boot_loop_body",
  },
  ota_rollback: {
    title: "dashboard.logs_doc_ota_rollback_title",
    body: "dashboard.logs_doc_ota_rollback_body",
  },
  nvs: {
    title: "dashboard.logs_doc_nvs_title",
    body: "dashboard.logs_doc_nvs_body",
  },
  ble_slots: {
    title: "dashboard.logs_doc_ble_slots_title",
    body: "dashboard.logs_doc_ble_slots_body",
  },
};

export function docPopoverText(
  link: LogDocLink,
  localize: LocalizeFunc
): LogDocPopoverText {
  const linkLabel = localize("dashboard.logs_doc_view");
  if (link.kind === "component") {
    // Catalog display name as the headline, catalog description as the
    // body — the same copy the editor's component panel leads with.
    return {
      heading: link.displayName || link.component,
      body: link.description,
      linkLabel,
    };
  }
  const keys = CURATED_COPY[link.body];
  return { heading: localize(keys.title), body: localize(keys.body), linkLabel };
}

/** Map ANSI spans to styled children (an unstyled span stays a bare string). */
export function renderSpanChildren(spans: AnsiSpan[]): (TemplateResult | string)[] {
  return spans.map((span) => styledSpan(span, span.text));
}

/**
 * ``renderSpanChildren`` with the tag token wrapped in the link button.
 *
 * ``link.tagRange`` indexes the concatenated span text (the ANSI-stripped
 * line), so per-span styling survives on multi-colour lines.
 */
export function renderSpanChildrenWithTagLink(
  spans: AnsiSpan[],
  link: ComponentLogDocLink,
  localize: LocalizeFunc,
  onOpen: OpenDocHandler
): (TemplateResult | string)[] {
  const { start, end } = link.tagRange;
  const title = componentLinkTitle(link, localize);
  const children: (TemplateResult | string)[] = [];
  let offset = 0;
  for (const span of spans) {
    const spanStart = offset;
    const spanEnd = offset + span.text.length;
    offset = spanEnd;
    if (spanEnd <= start || spanStart >= end) {
      children.push(styledSpan(span, span.text));
      continue;
    }
    const from = Math.max(start - spanStart, 0);
    const to = Math.min(end - spanStart, span.text.length);
    const before = span.text.slice(0, from);
    const tag = span.text.slice(from, to);
    const after = span.text.slice(to);
    // prettier-ignore
    children.push(styledSpan(span, html`${before}${tagLinkButton(tag, title, link, onOpen)}${after}`));
  }
  return children;
}

/** A curated/embedded actionable line: normal content + trailing info icon. */
export function renderActionableLine(
  inner: unknown,
  colorStyle: string,
  link: ActionableLogDocLink,
  localize: LocalizeFunc,
  onOpen: OpenDocHandler
): TemplateResult {
  const title = localize("dashboard.logs_doc_actionable_link_title");
  // prettier-ignore
  // Level colour on the container so the icon inherits it too; per-span
  // ANSI styles inside ``inner`` still override.
  return html`<div class="log-line log-line--doc" style=${colorStyle || nothing}><span class="log-line-text">${inner}</span><button class="log-doc-icon" type="button" title=${title} aria-label=${title} @click=${(e: MouseEvent) => onOpen(e, link)}><wa-icon library="mdi" name="information"></wa-icon></button></div>`;
}

/** Children of a colour-flat component line: clean text, tag wrapped. */
export function renderComponentLineChildren(
  link: ComponentLogDocLink,
  localize: LocalizeFunc,
  onOpen: OpenDocHandler
): (TemplateResult | string)[] {
  const { start, end } = link.tagRange;
  const title = componentLinkTitle(link, localize);
  return [
    link.clean.slice(0, start),
    tagLinkButton(link.clean.slice(start, end), title, link, onOpen),
    link.clean.slice(end),
  ];
}

function componentLinkTitle(link: ComponentLogDocLink, localize: LocalizeFunc): string {
  return localize("dashboard.logs_doc_component_link_title", {
    component: link.displayName || link.component,
  });
}

// prettier-ignore
function tagLinkButton(tag: string, title: string, link: ComponentLogDocLink, onOpen: OpenDocHandler): TemplateResult {
  // prettier-ignore
  return html`<button class="log-tag-link" type="button" title=${title} aria-label=${title} @click=${(e: MouseEvent) => onOpen(e, link)}>${tag}</button>`;
}

function styledSpan(
  span: AnsiSpan,
  content: TemplateResult | string
): TemplateResult | string {
  const style = [
    span.color ? `color:${span.color}` : "",
    span.bgColor ? `background:${span.bgColor}` : "",
  ]
    .filter(Boolean)
    .join(";");
  const classes = [span.bold ? "bold" : "", span.dim ? "dim" : ""]
    .filter(Boolean)
    .join(" ");
  if (style || classes) {
    // prettier-ignore
    return html`<span class=${classes || nothing} style=${style || nothing}>${content}</span>`;
  }
  return content;
}
