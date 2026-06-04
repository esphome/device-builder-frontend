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
import {
  createStickyRow,
  patchStickyRow,
  type GutterMetrics,
} from "./yaml-sticky-render.js";
import {
  computeStickyScope,
  findScopeExitLine,
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
  /** Offset (<= 0) applied to the bottom row so it slides out as its
   *  scope ends — Monaco's ``lastLineRelativePosition``. */
  lastLineRelativePosition: number;
  gutter: GutterMetrics;
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
      // Gutter geometry is a layout read (offsetWidth / getComputedStyle);
      // cache it and only re-measure on the requestMeasure path
      // (geometry/viewport changes), so the synchronous scroll handler never
      // forces layout. The gutter only resizes on those same events (e.g.
      // line-number digit count), so the cached value is current between
      // refreshes.
      private _gutter: GutterMetrics = {
        width: 0,
        lineNumberWidth: 0,
        padLeft: 0,
        padRight: 0,
      };

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
          read: (view) => {
            // Safe to read layout here (measure phase) — refresh runs on
            // geometry/viewport/doc changes, which is when the gutter can
            // resize. The scroll handler then reuses the cached width.
            const gutterEl = view.dom.querySelector<HTMLElement>(".cm-gutters");
            const lnEl = view.dom.querySelector<HTMLElement>(".cm-lineNumbers");
            // Read the cell's actual padding rather than hard-coding CM's
            // ``0 3px 0 5px`` default, so a CM bump or custom gutter theme
            // can't drift the pinned number off the real gutter.
            const cell = lnEl?.querySelector<HTMLElement>(".cm-gutterElement");
            const cs = cell ? getComputedStyle(cell) : null;
            this._gutter = {
              width: gutterEl ? gutterEl.offsetWidth : 0,
              lineNumberWidth: lnEl ? lnEl.offsetWidth : 0,
              padLeft: cs ? parseFloat(cs.paddingLeft) || 0 : 0,
              padRight: cs ? parseFloat(cs.paddingRight) || 0 : 0,
            };
            return this.measure(view);
          },
          write: (measured, view) => this.applyMeasured(measured, view),
        });
      }

      private measure(view: EditorView): MeasureResult | null {
        if (view.contentHeight <= 0) return null;
        const scrollTop = view.scrollDOM.scrollTop;
        const rowHeight = view.defaultLineHeight;
        const doc = view.state.doc;
        const lines = this.lines(view);
        const topLine = doc.lineAt(view.lineBlockAtHeight(scrollTop).from);
        const bottomLine = doc.lineAt(view.viewport.to).number;

        // Faithful port of VS Code / Monaco ``findScrollWidgetState`` — the
        // battle-tested algorithm the legacy (Monaco-based) dashboard used.
        // Candidate scopes are the chain enclosing the line at ``scrollTop``
        // (outermost first). A scope at nesting ``depth`` occupies stack
        // slot ``[(depth-1)*H, depth*H]`` from the overlay top. Relative to
        // ``scrollTop``: a scope is fully pinned while its slot bottom sits
        // between its header line's bottom and its end line's bottom; the
        // deepest scope whose slot top has entered its end line is sliding
        // out and drives ``lastLineRelativePosition`` (<= 0 — it pulls the
        // bottom row up as the scope ends, so a finished scope slides away
        // instead of lingering behind the overlay).
        const candidates = computeStickyScope(lines, topLine.number);
        const topOf = (n: number) => view.lineBlockAt(doc.line(n).from).top - scrollTop;
        const bottomOf = (n: number) =>
          view.lineBlockAt(doc.line(n).from).bottom - scrollTop;
        const scope: StickyScopeLine[] = [];
        let lastLineRelativePosition = 0;
        for (let i = 0; i < candidates.length; i++) {
          const cand = candidates[i];
          const start = cand.lineNumber;
          // Last line of the scope (1-indexed). Bounded to the rendered
          // viewport: a scope ending off-screen never slides, so clamping
          // its end to the last rendered line keeps the conditions correct
          // while capping the scan at O(viewport).
          const endExclusive = findScopeExitLine(
            lines,
            start,
            cand.indent,
            start + 1,
            bottomLine
          );
          const end = Math.min(endExclusive - 1, doc.lines);
          if (end - start <= 0) continue;
          const depth = i + 1;
          const topOfSlot = (depth - 1) * rowHeight;
          const bottomOfSlot = depth * rowHeight;
          const bottomOfHeaderLine = bottomOf(start);
          const topOfEndLine = topOf(end);
          const bottomOfEndLine = bottomOf(end);
          if (topOfSlot > topOfEndLine && topOfSlot <= bottomOfEndLine) {
            scope.push(cand);
            lastLineRelativePosition = bottomOfEndLine - bottomOfSlot;
            break;
          } else if (
            bottomOfSlot > bottomOfHeaderLine &&
            bottomOfSlot <= bottomOfEndLine
          ) {
            scope.push(cand);
          }
        }

        return {
          scope,
          lastLineRelativePosition,
          gutter: this._gutter,
          rowHeight,
        };
      }

      private applyMeasured(measured: MeasureResult | null, view: EditorView): void {
        if (!measured || measured.scope.length === 0) {
          this.setEmpty();
          return;
        }
        const { scope, lastLineRelativePosition, gutter, rowHeight } = measured;

        const { width, lineNumberWidth, padLeft, padRight } = gutter;
        const scopeKey = `${width}|${lineNumberWidth}|${padLeft}|${padRight}|${scope
          .map((l) => `${l.lineNumber}:${l.text}`)
          .join("\n")}`;
        if (scopeKey !== this._renderedKey) {
          this._renderedKey = scopeKey;
          this.render(scope, gutter, view);
        }

        // Each row is absolutely positioned at ``i*rowHeight``; the last
        // (deepest) row is offset by ``lastLineRelativePosition`` so it
        // slides up as its scope ends, tucking behind the row above it
        // (outer rows keep a higher z-index). The overlay clips to match,
        // so the sliding row is never left partially readable at rest.
        this.overlay.style.setProperty("--esphome-sticky-row-h", `${rowHeight}px`);
        const lastIdx = scope.length - 1;
        for (let i = 0; i < scope.length; i++) {
          const row = this.overlay.children[i] as HTMLDivElement | undefined;
          if (!row) continue;
          const offset = i === lastIdx ? lastLineRelativePosition : 0;
          const topStr = `${i * rowHeight + offset}px`;
          if (row.style.top !== topStr) row.style.top = topStr;
          const z = String(scope.length - i);
          if (row.style.zIndex !== z) row.style.zIndex = z;
        }

        const targetHeight = Math.max(
          0,
          scope.length * rowHeight + lastLineRelativePosition
        );
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
        gutter: GutterMetrics,
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
            gutter,
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

        const predictedScope = computeStickyScope(this.lines(this.view), lineNum);
        // Reserve room for the overlay that will pin at the destination so
        // the target lands below it; row height is the editor's stable
        // measured line height.
        const predictedHeight = predictedScope.length * this.view.defaultLineHeight;

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
