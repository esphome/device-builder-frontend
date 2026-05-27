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
 * Nesting is intentionally NOT supported — inline formatting won't
 * cascade inside other inline formatting (no `**bold with `code`**`).
 * The descriptions we get are simple enough that one level of
 * formatting per token covers the vocabulary; supporting nesting
 * would need a real Markdown parser. If that becomes a real problem
 * later, swap this util for `marked` or `micromark`.
 */
import { html, nothing } from "lit";
import type { TemplateResult } from "lit";

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
      return html`<strong>${seg.text}</strong>`;
    case "italic":
      return html`<em>${seg.text}</em>`;
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
