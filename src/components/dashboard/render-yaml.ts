import { html, type TemplateResult } from "lit";
import type { ConfiguredDevice, YamlSearchHit } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import {
  buildYamlSnippetBlocks,
  yamlEmptyMessageKey,
  yamlHitDeviceLabel,
  yamlSnippetBlockHref,
  type YamlSnippetBlock,
} from "../../util/yaml-search-helpers.js";
import { navigate } from "../../util/navigation.js";
import type { ESPHomePageDashboard } from "../../pages/dashboard.js";

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
  messageKey: string
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
  query: string
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
            <span class="yaml-snippet-text"
              >${isMatch ? highlightMatch(text, query) : text}</span
            >
          </div>
        `;
      })}
    </a>
  `;
}

function renderYamlDeviceTitle(
  configuration: string,
  trailing: TemplateResult | string,
  body: TemplateResult | string
): TemplateResult {
  const deviceHref = `/device/${encodeURIComponent(configuration)}`;
  return html`
    <section class="yaml-hit-group">
      <header class="yaml-hit-group-header">
        <wa-icon library="mdi" name="code-braces"></wa-icon>
        <a
          class="yaml-hit-group-name"
          href=${deviceHref}
          @click=${(e: MouseEvent) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            navigate(deviceHref);
          }}
          >${configuration}</a
        >
        ${trailing}
      </header>
      ${body}
    </section>
  `;
}

function renderYamlTitleList(devices: ConfiguredDevice[]): TemplateResult {
  return html`
    <div class="yaml-hits">
      ${devices.map((d) => renderYamlDeviceTitle(d.configuration, "", ""))}
    </div>
  `;
}

function renderYamlHits(
  localize: LocalizeFunc,
  hits: YamlSearchHit[],
  query: string
): TemplateResult {
  return html`
    <div class="yaml-hits">
      ${hits.map((hit) => {
        const blocks = buildYamlSnippetBlocks(hit.matches);
        const matchCount = hit.matches.length;
        const countUnit = localize(
          matchCount === 1
            ? "yaml_search.match_count_singular"
            : "yaml_search.match_count_plural"
        );
        const trailing = html`<span class="yaml-hit-group-count"
          >${matchCount} ${countUnit}</span
        >`;
        const body = html`${blocks.map((block) => renderSnippetBlock(hit, block, query))}`;
        return renderYamlDeviceTitle(yamlHitDeviceLabel(hit), trailing, body);
      })}
    </div>
  `;
}

export function renderYamlMode(host: ESPHomePageDashboard): TemplateResult {
  const query = host._search.trim();
  const hits = host._yamlSearch.hits;
  if (!query) return renderYamlTitleList(host._sortedDevices);
  const emptyKey = yamlEmptyMessageKey(hits);
  if (emptyKey) return renderYamlEmptyState(host._localize, emptyKey);
  return renderYamlHits(host._localize, hits ?? [], query);
}

export function renderYamlPreviewPivot(
  localize: LocalizeFunc,
  previewCount: number,
  onPivot: () => void
): TemplateResult | string {
  if (previewCount === 0) return "";
  return html`<button class="empty-search-yaml-pivot" @click=${onPivot}>
    <wa-icon library="mdi" name="code-braces"></wa-icon>
    ${localize(
      previewCount === 1
        ? "yaml_search.no_match_yaml_preview"
        : "yaml_search.no_match_yaml_preview_plural",
      { count: previewCount }
    )}
  </button>`;
}
