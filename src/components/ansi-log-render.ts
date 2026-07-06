/**
 * Line-rendering helpers for ``ansi-log``.
 *
 * Holds the ANSI span → template mapping plus the two doc-annotated line
 * shapes (a curated/embedded ``actionable`` line with a trailing info icon,
 * and a ``component`` line whose ``[tag:line]`` token becomes a quiet link).
 * The affordances sit outside the selectable text — the icon is
 * ``user-select: none`` and the tag stays plain text — so a multi-line
 * drag-select still copies clean log text.
 */
import { mdiInformationOutline } from "@mdi/js";
import { css, html, nothing, type TemplateResult } from "lit";
import type { LocalizeFunc } from "../common/localize.js";
import type { LogDocLink } from "../util/log-doc-links.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ "information-outline": mdiInformationOutline });

/** Styles for the annotated line shapes; spread into ansi-log's shadow DOM. */
export const logDocLinkStyles = css`
  /* Actionable line: text keeps pre-wrap in its own column so the trailing
     icon can sit in the right margin without joining the selectable text. */
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
    color: inherit;
    font-size: 15px;
    line-height: 1;
    opacity: 0.55;
    cursor: pointer;
  }

  .log-doc-icon:hover,
  .log-doc-icon:focus-visible {
    opacity: 1;
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

export function docPopoverText(
  link: LogDocLink,
  localize: LocalizeFunc
): LogDocPopoverText {
  const linkLabel = localize("dashboard.logs_doc_view");
  switch (link.body) {
    case "bootloader":
      return {
        heading: localize("dashboard.logs_doc_bootloader_title"),
        body: localize("dashboard.logs_doc_bootloader_body"),
        linkLabel,
      };
    case "chip_revision":
      return {
        heading: localize("dashboard.logs_doc_chip_revision_title"),
        body: localize("dashboard.logs_doc_chip_revision_body"),
        linkLabel,
      };
    case "embedded":
      return {
        heading: localize("dashboard.logs_doc_embedded_title"),
        body: localize("dashboard.logs_doc_embedded_body"),
        linkLabel,
      };
    case "component": {
      const component = link.component ?? "";
      return {
        heading: component,
        body: localize("dashboard.logs_doc_component_body", { component }),
        linkLabel,
      };
    }
  }
}

/** Map ANSI spans to styled children (fast path returns a bare string). */
export function renderSpanChildren(spans: AnsiSpan[]): (TemplateResult | string)[] {
  // prettier-ignore keeps each <span> on one line: the parent .log-line uses
  // white-space: pre-wrap, so inter-tag whitespace would render as blank rows.
  return spans.map((span) => {
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
      return html`<span class=${classes || nothing} style=${style || nothing}>${span.text}</span>`;
    }
    return span.text;
  });
}

/** A curated/embedded actionable line: normal content + trailing info icon. */
export function renderActionableLine(
  inner: unknown,
  colorStyle: string,
  link: LogDocLink,
  localize: LocalizeFunc,
  onOpen: OpenDocHandler
): TemplateResult {
  const title = localize("dashboard.logs_doc_actionable_link_title");
  // prettier-ignore
  return html`<div class="log-line log-line--doc"><span class="log-line-text" style=${colorStyle || nothing}>${inner}</span><button class="log-doc-icon" type="button" title=${title} aria-label=${title} @click=${(e: MouseEvent) => onOpen(e, link)}><wa-icon library="mdi" name="information-outline"></wa-icon></button></div>`;
}

/** A component line: the [tag:line] token becomes a quiet inline link. */
export function renderComponentLine(
  clean: string,
  colorStyle: string,
  link: LogDocLink,
  localize: LocalizeFunc,
  onOpen: OpenDocHandler
): TemplateResult {
  const range = link.tagRange;
  if (!range)
    return html`<div class="log-line" style=${colorStyle || nothing}>${clean}</div>`;
  const before = clean.slice(0, range.start);
  const tag = clean.slice(range.start, range.end);
  const after = clean.slice(range.end);
  const title = localize("dashboard.logs_doc_component_link_title", {
    component: link.component ?? "",
  });
  // prettier-ignore
  return html`<div class="log-line" style=${colorStyle || nothing}>${before}<button class="log-tag-link" type="button" title=${title} aria-label=${title} @click=${(e: MouseEvent) => onOpen(e, link)}>${tag}</button>${after}</div>`;
}
