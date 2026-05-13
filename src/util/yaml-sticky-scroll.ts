/**
 * Sticky-scroll overlay for the ESPHome YAML editor — restores the
 * legacy esphome dashboard's behaviour where the enclosing
 * indentation scope (``sensor:`` → ``- platform: …`` → ``devices:``
 * → ``- device: …``) stays pinned to the top of the editor as the
 * user scrolls through a long config, so they always know which
 * component / block they're editing.
 *
 * CodeMirror 6 has no first-party sticky scroll, so this is a small
 * custom ``ViewPlugin``:
 *
 *   1. On each scroll / viewport change, find the topmost rendered
 *      line via ``lineBlockAtHeight(scrollTop)``.
 *   2. Walk the document text backwards from there with
 *      ``computeStickyScope`` to collect each strictly-less-indented
 *      ancestor line.
 *   3. Render those ancestor lines in an absolutely-positioned
 *      overlay attached to ``cm-editor``, mimicking the editor's
 *      gutter + content layout so the sticky rows look like the
 *      real lines that just scrolled past.
 *
 * Syntax highlighting in the overlay re-uses the same
 * ``HighlightStyle`` instance the editor mounts via
 * ``syntaxHighlighting`` — the per-tag class names match exactly,
 * so the overlay's spans pick up the editor's existing CSS for
 * free (no parallel theme, no class-name drift).
 *
 * Scroll margins are bumped by the overlay's measured height so
 * ``EditorView.scrollIntoView`` calls (find-jump, validation goto,
 * section-editor scroll) land their target below the sticky rather
 * than behind it.
 *
 * Click handling on a sticky row scrolls the editor to the
 * corresponding line and parks the cursor there, matching the
 * legacy dashboard's affordance.
 */
import type { HighlightStyle } from "@codemirror/language";
import { syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  type PluginValue,
  type ViewUpdate,
} from "@codemirror/view";
import { indentOf, stripComment } from "./yaml-line-walker.js";
import { createStickyRow, patchStickyRow } from "./yaml-sticky-render.js";
import {
  computeStickyScope,
  findScopeExitLine,
  isScopeOpener,
  type StickyScopeLine,
} from "./yaml-sticky-scope.js";
import { buildStickyTheme } from "./yaml-sticky-theme.js";

export interface StickyScrollOptions {
  highlightStyle: HighlightStyle;
  background: string;
}

interface StickyScrollState extends PluginValue {
  readonly height: number;
}

interface MeasureResult {
  scope: StickyScopeLine[];
  gutterWidth: number;
  exitYs: number[];
  slideInYs: number[];
  scrollTop: number;
  rowHeight: number;
}

const STICKY_MEASURE_KEY = Symbol("esphome-sticky-scroll");

export function yamlStickyScroll(options: StickyScrollOptions): Extension {
  const { highlightStyle, background } = options;

  const plugin = ViewPlugin.fromClass(
    class StickyScrollPluginImpl implements StickyScrollState {
      readonly overlay: HTMLDivElement;
      private _renderedKey = "";
      private _renderedCount = 0;
      private _measuredHeight = 0;

      constructor(readonly view: EditorView) {
        this.overlay = document.createElement("div");
        this.overlay.className = "cm-esphome-sticky";
        this.overlay.addEventListener("click", this.onClick);
        view.dom.appendChild(this.overlay);
        this.refresh();
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || update.geometryChanged) {
          this.refresh();
        }
      }

      destroy(): void {
        this.overlay.removeEventListener("click", this.onClick);
        this.overlay.remove();
      }

      get height(): number {
        return this._measuredHeight;
      }

      refresh(): void {
        this.view.requestMeasure({
          key: STICKY_MEASURE_KEY,
          read: (view) => this.measure(view),
          write: (measured, view) => this.applyMeasured(measured, view),
        });
      }

      private measure(view: EditorView): MeasureResult | null {
        if (view.contentHeight <= 0) return null;
        const scrollTop = view.scrollDOM.scrollTop;
        const rowHeight = view.defaultLineHeight;
        const block = view.lineBlockAtHeight(scrollTop);
        const topLine = view.state.doc.lineAt(block.from);
        const gutterEl = view.dom.querySelector<HTMLElement>(".cm-gutters");
        const gutterWidth = gutterEl ? gutterEl.offsetWidth : 0;
        const lines = view.state.doc.toString().split("\n");
        const scope = computeStickyScope(lines, topLine.number);
        if (isScopeOpener(lines, topLine.number)) {
          const stripped = stripComment(lines[topLine.number - 1]);
          scope.push({
            lineNumber: topLine.number,
            indent: indentOf(stripped),
            text: lines[topLine.number - 1],
          });
        }
        const exitYs: number[] = scope.map((s) => {
          const exitLine = findScopeExitLine(lines, s.lineNumber, s.indent);
          if (exitLine > lines.length) return Number.POSITIVE_INFINITY;
          const cm6Line = view.state.doc.line(exitLine);
          return view.lineBlockAt(cm6Line.from).top;
        });
        const slideInYs: number[] = scope.map(() => Number.NEGATIVE_INFINITY);
        const lastIdx = scope.length - 1;
        if (
          lastIdx >= 0 &&
          scope[lastIdx].lineNumber === topLine.number &&
          topLine.number < view.state.doc.lines
        ) {
          const bodyLine = view.state.doc.line(topLine.number + 1);
          slideInYs[lastIdx] = view.lineBlockAt(bodyLine.from).top;
        }
        return {
          scope,
          gutterWidth,
          exitYs,
          slideInYs,
          scrollTop,
          rowHeight,
        };
      }

      private applyMeasured(measured: MeasureResult | null, view: EditorView): void {
        if (!measured) {
          this.setEmpty();
          return;
        }
        const { scope, gutterWidth, exitYs, slideInYs, scrollTop, rowHeight } = measured;

        if (scope.length === 0) {
          this.setEmpty();
          return;
        }

        const scopeKey = `${gutterWidth}|${scope
          .map((l) => `${l.lineNumber}:${l.text}`)
          .join("\n")}`;
        if (scopeKey !== this._renderedKey) {
          this._renderedKey = scopeKey;
          this.render(scope, gutterWidth, view);
        }
        this.applyShifts(scope, exitYs, slideInYs, scrollTop, rowHeight);
      }

      private applyShifts(
        scope: StickyScopeLine[],
        exitYs: number[],
        slideInYs: number[],
        scrollTop: number,
        rowHeight: number
      ): void {
        let cumulativeShift = 0;
        let totalShift = 0;
        for (let i = 0; i < scope.length; i++) {
          const row = this.overlay.children[i] as HTMLDivElement | undefined;

          if (!row) continue;
          const exitY = exitYs[i];
          const slideInY = slideInYs[i];
          const slideOutShift = Math.round(
            Math.max(0, Math.min(rowHeight, rowHeight - (exitY - scrollTop)))
          );
          const slideInShift = Math.round(
            Math.max(0, Math.min(rowHeight, slideInY - scrollTop))
          );
          const ownTopShift = slideInShift > 0 && slideOutShift === 0 ? 0 : slideOutShift;
          const translateAmount = cumulativeShift + ownTopShift;
          const transform =
            translateAmount > 0 ? `translateY(-${translateAmount}px)` : "";
          if (row.style.transform !== transform) {
            row.style.transform = transform;
          }
          cumulativeShift += ownTopShift;
          totalShift += ownTopShift + slideInShift;

          const z = String(scope.length - i);
          if (row.style.zIndex !== z) {
            row.style.zIndex = z;
          }
        }

        const targetHeight = Math.max(0, scope.length * rowHeight - totalShift);
        const heightStr = `${targetHeight}px`;
        if (this.overlay.style.height !== heightStr) {
          this.overlay.style.height = heightStr;
        }

        const previous = this._measuredHeight;
        this._measuredHeight = targetHeight;
        if (Math.abs(previous - targetHeight) > 0.5) {
          this.view.requestMeasure();
        }
      }

      private setEmpty(): void {
        if (this.overlay.childNodes.length === 0 && this._measuredHeight === 0) {
          return;
        }
        this.overlay.replaceChildren();
        this.overlay.style.height = "";
        this._renderedKey = "";
        this._renderedCount = 0;
        const previous = this._measuredHeight;
        this._measuredHeight = 0;
        if (previous !== 0) {
          this.view.requestMeasure();
        }
      }

      private render(
        scope: StickyScopeLine[],
        gutterWidth: number,
        view: EditorView
      ): void {
        const tree = syntaxTree(view.state);
        for (let i = 0; i < scope.length; i++) {
          const sticky = scope[i];
          let row = this.overlay.children[i] as HTMLDivElement | undefined;
          if (!row) {
            row = createStickyRow();
            this.overlay.appendChild(row);
          }
          patchStickyRow(row, sticky, gutterWidth, tree, view.state, highlightStyle);
        }
        while (this.overlay.children.length > scope.length) {
          this.overlay.lastElementChild!.remove();
        }
        this._renderedCount = scope.length;
      }

      onClick = (e: Event): void => {
        const target = (e.target as HTMLElement).closest<HTMLElement>(
          ".cm-esphome-sticky-line"
        );
        if (!target) return;
        const lineNum = Number(target.dataset.line);
        if (!Number.isFinite(lineNum) || lineNum < 1) return;
        const { state } = this.view;
        if (lineNum > state.doc.lines) return;
        const line = state.doc.line(lineNum);

        const linesText = state.doc.toString().split("\n");
        const predictedScope = computeStickyScope(linesText, lineNum);
        const rowHeight =
          this._renderedCount > 0
            ? this._measuredHeight / this._renderedCount
            : this.view.defaultLineHeight;
        const predictedHeight = predictedScope.length * rowHeight;

        const yMargin = Math.ceil(predictedHeight) - this._measuredHeight;

        this.view.dispatch({
          selection: { anchor: line.from },
          effects: EditorView.scrollIntoView(line.from, {
            y: "start",
            yMargin,
          }),
        });
        this.view.focus();
      };
    },
    {
      eventObservers: {
        scroll() {
          this.refresh();
        },
      },
      provide: (p) => [
        EditorView.scrollMargins.of((view) => {
          const instance = view.plugin(p);
          const top = instance?.height ?? 0;
          return top > 0 ? { top } : null;
        }),
        buildStickyTheme(background),
      ],
    }
  );

  return plugin;
}
