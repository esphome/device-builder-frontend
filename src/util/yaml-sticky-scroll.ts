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
import type { Extension, Text } from "@codemirror/state";
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
  /** Localized accessible name / tooltip for a pinned row, e.g.
   *  "Jump to line 42". Passed in so the overlay doesn't hard-code
   *  English copy. */
  jumpToLineLabel: (lineNumber: number) => string;
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

/** Resolve the 1-indexed line number from a sticky-row event, or null
 *  when the event didn't originate on a pinned row. Shared by the click
 *  and keyboard handlers. */
function lineFromEvent(e: Event): number | null {
  // A click can land on a highlighted-token Text node, which has no
  // ``closest``; start from its parent element in that case.
  const node = e.target as Node;
  const start = node instanceof Element ? node : node.parentElement;
  const target = start?.closest<HTMLElement>(".cm-esphome-sticky-line");
  if (!target) return null;
  const lineNum = Number(target.dataset.line);
  return Number.isFinite(lineNum) && lineNum >= 1 ? lineNum : null;
}

export function yamlStickyScroll(options: StickyScrollOptions): Extension {
  const { highlightStyle, background, jumpToLineLabel } = options;

  const plugin = ViewPlugin.fromClass(
    class StickyScrollPluginImpl implements StickyScrollState {
      readonly overlay: HTMLDivElement;
      private _renderedKey = "";
      private _measuredHeight = 0;
      // Cache the split document so scroll/geometry measures don't
      // re-serialize the whole file on every event; rebuilt only when
      // the doc instance changes (i.e. an edit landed).
      private _lines: string[] = [];
      private _linesDoc: Text | null = null;

      constructor(readonly view: EditorView) {
        this.overlay = document.createElement("div");
        this.overlay.className = "cm-esphome-sticky";
        this.overlay.addEventListener("click", this.onClick);
        this.overlay.addEventListener("keydown", this.onKeydown);
        view.dom.appendChild(this.overlay);
        // Listen on the scroller directly. A ViewPlugin ``scroll``
        // eventObserver doesn't fire reliably, and ``update()`` only sees
        // ``viewportChanged`` when CM re-renders new lines — so in a tall
        // editor a small scroll within the rendered range would never
        // refresh the overlay, leaving a stale section pinned.
        view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
        this.refresh();
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || update.geometryChanged) {
          this.refresh();
        }
      }

      destroy(): void {
        this.overlay.removeEventListener("click", this.onClick);
        this.overlay.removeEventListener("keydown", this.onKeydown);
        this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
        this.overlay.remove();
      }

      private onScroll = (): void => {
        // Measure + apply synchronously off the live scroll position.
        // Deferring via requestMeasure lagged a frame behind continuous
        // scrolling, so the pinned scope trailed the viewport (a sibling
        // you'd scrolled past stayed pinned). The reads here hit CM's
        // height oracle / cached layout, not a forced reflow.
        this.applyMeasured(this.measure(this.view), this.view);
      };

      get height(): number {
        return this._measuredHeight;
      }

      /** Document lines for the current ``doc``, cached so repeated
       *  scroll/measure passes reuse the array (#1). */
      private lines(view: EditorView): string[] {
        const doc = view.state.doc;
        if (this._linesDoc !== doc) {
          this._lines = doc.toString().split("\n");
          this._linesDoc = doc;
        }
        return this._lines;
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
        const lines = this.lines(view);
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
        // Pin each overlay row to the editor's measured line height so
        // the rendered rows are exactly as tall as the math assumes (#4).
        this.overlay.style.setProperty("--esphome-sticky-row-h", `${rowHeight}px`);
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
          patchStickyRow(
            row,
            sticky,
            gutterWidth,
            tree,
            view.state,
            highlightStyle,
            jumpToLineLabel
          );
        }
        while (this.overlay.children.length > scope.length) {
          this.overlay.lastElementChild!.remove();
        }
      }

      onClick = (e: Event): void => {
        const lineNum = lineFromEvent(e);
        if (lineNum !== null) this.jumpToLine(lineNum);
      };

      onKeydown = (e: KeyboardEvent): void => {
        // Sticky rows are role="button"; mirror native button keys.
        // Space is prevented so it doesn't scroll the page instead (#2).
        if (e.key !== "Enter" && e.key !== " ") return;
        const lineNum = lineFromEvent(e);
        if (lineNum === null) return;
        e.preventDefault();
        this.jumpToLine(lineNum);
      };

      private jumpToLine(lineNum: number): void {
        const { state } = this.view;
        if (lineNum > state.doc.lines) return;
        const line = state.doc.line(lineNum);

        const linesText = this.lines(this.view);
        const predictedScope = computeStickyScope(linesText, lineNum);
        // ``measure()`` also pins the clicked line itself when it's a
        // scope opener, so count that extra row or the target lands
        // partly behind the overlay (#7).
        const predictedCount =
          predictedScope.length + (isScopeOpener(linesText, lineNum) ? 1 : 0);
        // Use the editor's stable measured line height. Dividing the
        // post-shift overlay height by the row count underestimates it
        // mid-transition and skews the margin (#3).
        const rowHeight = this.view.defaultLineHeight;
        const predictedHeight = predictedCount * rowHeight;

        // Clamp to >= 0: jumping from a deeper (taller) scope to a
        // shallower one makes the predicted overlay shorter than the
        // current one, and a negative margin would push the target up
        // behind the overlay.
        const yMargin = Math.max(0, Math.ceil(predictedHeight) - this._measuredHeight);

        this.view.dispatch({
          selection: { anchor: line.from },
          effects: EditorView.scrollIntoView(line.from, {
            y: "start",
            yMargin,
          }),
        });
        this.view.focus();
      }
    },
    {
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
