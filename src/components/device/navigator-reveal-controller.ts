import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { NavigatorBuckets } from "./navigator-buckets.js";

/** What the section list looks like at one host update. */
export interface RevealState {
  /** YAML line of the selected section, or null when nothing is selected. */
  selectedLine: number | null;
  buckets: NavigatorBuckets;
  /** Indices (0 core / 1 components / 2 automations) currently expanded. */
  openSections: Set<number>;
  /** A search query is active (sections force-open); don't toggle them. */
  filtering: boolean;
}

/** Host surface the controller drives: render root, event dispatch, plumbing. */
export interface RevealHost extends ReactiveControllerHost {
  renderRoot: ParentNode;
  dispatchEvent(event: Event): boolean;
}

/** Section index (0 core / 1 components / 2 automations) whose bucket holds a
 *  section starting at *line*, or -1 (e.g. an unscoped automation, no nav row). */
export function sectionIndexForLine(buckets: NavigatorBuckets, line: number): number {
  if (buckets.core.some((s) => s.fromLine === line)) return 0;
  if (buckets.components.some((s) => s.fromLine === line)) return 1;
  if (buckets.automations.some((s) => s.fromLine === line)) return 2;
  return -1;
}

/**
 * Reveal the externally-selected nav row (YAML cursor / URL restore):
 * expand its collapsed section, then scroll it into view on the next render.
 * Latches the scrolled line so idle re-renders (hover, search) don't re-scroll.
 *
 * Opening fires the idempotent 'section-reveal' (a set, not a toggle); two
 * navigator instances share one openSections, so a toggle would race and
 * oscillate the section open/closed forever.
 */
export class NavigatorRevealController implements ReactiveController {
  private _scrolledLine: number | null = null;

  constructor(
    private readonly _host: RevealHost,
    private readonly _read: () => RevealState
  ) {
    _host.addController(this);
  }

  hostUpdated(): void {
    const { selectedLine, buckets, openSections, filtering } = this._read();
    if (selectedLine === null) {
      this._scrolledLine = null;
      return;
    }
    if (selectedLine === this._scrolledLine) return;
    const index = sectionIndexForLine(buckets, selectedLine);
    if (index === -1) {
      // No navigator row for this line (e.g. an unscoped automation); latch so
      // we don't re-scan the buckets on every later update.
      this._scrolledLine = selectedLine;
      return;
    }
    if (!filtering && !openSections.has(index)) {
      // Ask the page to open it and bail; the re-render re-enters with the row.
      this._host.dispatchEvent(
        new CustomEvent("section-reveal", {
          detail: { index },
          bubbles: true,
          composed: true,
        })
      );
      return;
    }
    // Latch only on a confirmed scroll, so the reveal retries when the row
    // becomes scrollable. querySelector finds a row that isn't yet rendered
    // (collapsed Components subgroup) or whose nav is display:none (collapsed
    // desktop nav), and scrolling either is a silent no-op; checkVisibility
    // screens both out (and is absent in older engines, so we fall through).
    const row = this._host.renderRoot.querySelector(".nav-item--selected");
    if (row && isVisible(row)) {
      row.scrollIntoView({ block: "nearest" });
      this._scrolledLine = selectedLine;
    }
  }
}

function isVisible(el: Element): boolean {
  const check = (el as { checkVisibility?: () => boolean }).checkVisibility;
  return check ? check.call(el) : true;
}
