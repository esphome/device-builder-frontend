import { html, type TemplateResult } from "lit";
import type { YamlSearchHit } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import {
  buildYamlSnippetBlocks,
  yamlEmptyMessageKey,
  yamlHitDeviceLabel,
  yamlSnippetBlockHref,
  type YamlSnippetBlock,
} from "../../util/yaml-search-helpers.js";
import { navigate } from "../../util/navigation.js";

export function highlightMatch(text: string, needle: string): unknown {
  if (!needle) return text;
  const lower = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const out: Array<unknown> = [];
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(lowerNeedle, i);
    if (idx === -1) {
      out.push(text.slice(i));
      break;
    }
    if (idx > i) out.push(text.slice(i, idx));
    out.push(html`<mark>${text.slice(idx, idx + needle.length)}</mark>`);
    i = idx + needle.length;
  }
  return out;
}

export function renderYamlEmptyState(
  localize: LocalizeFunc,
  messageKey: string,
): TemplateResult {
  return html`
    <div class="empty-search">
      <wa-icon class="empty-search-icon" library="mdi" name="code-braces"></wa-icon>
      <p class="empty-search-desc">${localize(messageKey)}</p>
    </div>
  `;
}

function renderSnippetBlock(
  hit: YamlSearchHit,
  block: YamlSnippetBlock,
  query: string,
): TemplateResult {
  const href = yamlSnippetBlockHref(hit, block);
  return html`
    <a
      class="yaml-snippet"
      href=${href}
      @click=${(e: MouseEvent) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(href);
      }}
    >
      ${block.lines.map((text, i) => {
        const lineNumber = block.startLine + i;
        const isMatch = block.matchedLines.has(lineNumber);
        return html`
          <div class="yaml-snippet-line ${isMatch ? "yaml-snippet-line--match" : ""}">
            <span class="yaml-snippet-gutter">${lineNumber}</span>
            <span class="yaml-snippet-text">${isMatch ? highlightMatch(text, query) : text}</span>
          </div>
        `;
      })}
    </a>
  `;
}

export function renderYamlMode(
  localize: LocalizeFunc,
  hits: YamlSearchHit[] | null,
  query: string,
): TemplateResult {
  if (!query) return renderYamlEmptyState(localize, "yaml_search.placeholder");
  const emptyKey = yamlEmptyMessageKey(hits);
  if (emptyKey) return renderYamlEmptyState(localize, emptyKey);
  return html`
    <div class="yaml-hits">
      ${(hits ?? []).map((hit) => {
        const blocks = buildYamlSnippetBlocks(hit.matches);
        const matchCount = hit.matches.length;
        const countUnit = localize(
          matchCount === 1
            ? "yaml_search.match_count_singular"
            : "yaml_search.match_count_plural",
        );
        return html`
          <section class="yaml-hit-group">
            <header class="yaml-hit-group-header">
              <wa-icon library="mdi" name="code-braces"></wa-icon>
              <span class="yaml-hit-group-name">${yamlHitDeviceLabel(hit)}</span>
              <span class="yaml-hit-group-count">${matchCount} ${countUnit}</span>
            </header>
            ${blocks.map((block) => renderSnippetBlock(hit, block, query))}
          </section>
        `;
      })}
    </div>
  `;
}

export function renderYamlPreviewPivot(
  localize: LocalizeFunc,
  previewCount: number,
  onPivot: () => void,
): TemplateResult | string {
  if (previewCount === 0) return "";
  return html`<button class="empty-search-yaml-pivot" @click=${onPivot}>
    <wa-icon library="mdi" name="code-braces"></wa-icon>
    ${localize(
      previewCount === 1
        ? "yaml_search.no_match_yaml_preview"
        : "yaml_search.no_match_yaml_preview_plural",
      { count: previewCount },
    )}
  </button>`;
}
