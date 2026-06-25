/**
 * Tiny Markdown renderer for ESPHome catalog descriptions.
 *
 * The descriptions the backend forwards from ESPHome's component
 * docstrings include a small slice of Markdown:
 *   - `[text](url)` — links to docs / referenced components
 *   - `` `code` `` — config keys, literal values like `true`/`false`
 *   - `**bold**` — emphasis
 *   - `*italic*` / `_italic_` — emphasis (rare, kept for completeness)
 *
 * Anything else is left as plain text. The renderer emits Lit
 * templates so user content is escaped safely (no `unsafeHTML`,
 * nothing gets injected into innerHTML).
 *
 * Bold and italic render one level of nested inline formatting, so a
 * link or `` `code` `` inside `**...**` still renders — ESPHome
 * docstrings bold-wrap links (`**[Action](url)**:`). Deeper nesting
 * isn't supported; the descriptions we get don't need it. If that
 * changes, swap this util for `marked` or `micromark`.
 */
import type { TemplateResult } from "lit";
import { html, nothing } from "lit";

interface Segment {
  kind: "text" | "link" | "code" | "bold" | "italic";
  text: string;
  href?: string;
}

/**
 * Schemes we render as live anchors. Catalog descriptions in
 * practice only use ``http(s)://`` (docs cross-references) and a
 * handful of ``mailto:`` links to maintainers; anything else
 * (``javascript:``, ``data:``, ``vbscript:``, ``file:``, bare
 * fragments, scheme-less relative URLs) falls back to plain text
 * so a future supply-chain compromise of the catalog data can't
 * inject a clickable XSS vector. Repo-controlled today, so this
 * is defense in depth — see esphome/device-builder#120 (F-1).
 *
 * Exported for the unit test; production callers should go
 * through ``renderMarkdown`` which gates link rendering on this.
 */
const SAFE_LINK_SCHEMES = /^\s*(?:https?|mailto):/i;

export function isSafeLinkHref(href: string | undefined): boolean {
  return href !== undefined && SAFE_LINK_SCHEMES.test(href);
}

/**
 * Single regex with prioritised alternatives — alternatives are
 * tried left-to-right so links match before bold and bold matches
 * before italic (so `**foo**` is one bold token, not two italics).
 *
 *   Group 1 + 2: link `[text](url)`
 *   Group 3:     inline code `` `text` ``
 *   Group 4:     bold `**text**`
 *   Group 5:     italic `*text*`
 *   Group 6:     italic `_text_`
 */
const MARKDOWN_RE =
  /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|(?<![\w*])\*([^*\s][^*]*?[^*\s]|[^*\s])\*(?!\w)|(?<![\w_])_([^_\s][^_]*?[^_\s]|[^_\s])_(?!\w)/g;

function parseMarkdown(input: string): Segment[] {
  const segments: Segment[] = [];
  let lastIdx = 0;
  // Reset regex state — `MARKDOWN_RE` is a module-level RegExp with
  // the `g` flag so its `lastIndex` persists between calls.
  MARKDOWN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKDOWN_RE.exec(input)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ kind: "text", text: input.slice(lastIdx, match.index) });
    }
    if (match[1] !== undefined) {
      segments.push({ kind: "link", text: match[1], href: match[2] });
    } else if (match[3] !== undefined) {
      segments.push({ kind: "code", text: match[3] });
    } else if (match[4] !== undefined) {
      segments.push({ kind: "bold", text: match[4] });
    } else if (match[5] !== undefined) {
      segments.push({ kind: "italic", text: match[5] });
    } else if (match[6] !== undefined) {
      segments.push({ kind: "italic", text: match[6] });
    }
    lastIdx = MARKDOWN_RE.lastIndex;
  }
  if (lastIdx < input.length) {
    segments.push({ kind: "text", text: input.slice(lastIdx) });
  }
  return segments;
}

function renderSegment(seg: Segment): TemplateResult | string {
  switch (seg.kind) {
    case "text":
      return seg.text;
    case "link":
      // Unsafe (or missing) scheme → fall back to the link text as
      // plain content so a ``[click me](javascript:alert(1))`` in
      // the catalog can't render as a live anchor. The ``[text]``
      // is preserved so the user still sees the words.
      if (!isSafeLinkHref(seg.href)) {
        return seg.text;
      }
      return html`<a
        class="md-link"
        href=${seg.href ?? ""}
        target="_blank"
        rel="noopener noreferrer"
        >${seg.text}</a
      >`;
    case "code":
      return html`<code class="md-code">${seg.text}</code>`;
    case "bold":
      return html`<strong>${parseMarkdown(seg.text).map(renderSegment)}</strong>`;
    case "italic":
      return html`<em>${parseMarkdown(seg.text).map(renderSegment)}</em>`;
  }
}

/**
 * Render `input` as inline Markdown. Returns `nothing` for empty /
 * null input so callers can drop it into a template without a
 * conditional. Output is a Lit template; safe to interpolate.
 */
export function renderMarkdown(
  input: string | null | undefined
): TemplateResult | typeof nothing {
  if (!input) return nothing;
  const segments = parseMarkdown(input);
  return html`${segments.map(renderSegment)}`;
}

/** Bare http(s) URLs embedded in otherwise-plain text (validation messages). */
const BARE_URL_RE = /https?:\/\/[^\s<>]+/g;

/** Sentence punctuation that trails a URL in prose but isn't part of it. */
const TRAILING_PUNCT_RE = /[.,;:!?]+$/;

export interface TextLinkSegment {
  text: string;
  /** Present only when 'text' is a safe, clickable URL. */
  href?: string;
}

/**
 * Split plain text into text / URL segments, autolinking bare http(s) URLs.
 *
 * Trailing sentence punctuation (and an unbalanced close paren) is peeled back
 * into the following text so the link stops at the URL. The isSafeLinkHref gate
 * keeps this in lockstep with renderMarkdown. Plain text only, no Markdown.
 */
export function splitTextLinks(input: string): TextLinkSegment[] {
  const segments: TextLinkSegment[] = [];
  let last = 0;
  for (const match of input.matchAll(BARE_URL_RE)) {
    const start = match.index!;
    let url = match[0];
    let tail = "";
    // Order matters: strip the punctuation run first, then the unbalanced
    // paren, so 'Foo_(bar).' keeps ')' but drops '.'.
    const punct = url.match(TRAILING_PUNCT_RE);
    if (punct) {
      tail = punct[0];
      url = url.slice(0, -tail.length);
    }
    if (url.endsWith(")") && !url.includes("(")) {
      tail = `)${tail}`;
      url = url.slice(0, -1);
    }
    if (start > last) segments.push({ text: input.slice(last, start) });
    // href is set for every match today (BARE_URL_RE is http(s)-only); the gate
    // mirrors renderMarkdown so a broader matcher later can't emit an unsafe anchor.
    segments.push(isSafeLinkHref(url) ? { text: url, href: url } : { text: url });
    if (tail) segments.push({ text: tail });
    last = start + match[0].length;
  }
  if (last < input.length) segments.push({ text: input.slice(last) });
  return segments;
}

/**
 * Render plain text as a Lit template, autolinking bare URLs as new-tab
 * anchors. Returns `nothing` for empty input; output is escaped (no unsafeHTML).
 */
export function renderTextLinks(
  input: string | null | undefined
): TemplateResult | typeof nothing {
  if (!input) return nothing;
  return html`${splitTextLinks(input).map((seg) =>
    seg.href
      ? html`<a class="md-link" href=${seg.href} target="_blank" rel="noopener noreferrer"
          >${seg.text}</a
        >`
      : seg.text
  )}`;
}
