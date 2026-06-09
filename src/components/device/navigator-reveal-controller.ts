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
  // Section reveal is one-shot per selected line. The scroll below only
  // latches once the row is actually visible, and a row inside a collapsed
  // subgroup (or the hidden desktop nav) never gets there — without this
  // guard every later render re-fires section-reveal, forcing the cursor's
  // section back open and locking the user out of toggling any other section.
  private _revealedLine: number | null = null;

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
      this._revealedLine = null;
      return;
    }
    // The selection genuinely moved to a different line: drop the stale latch
    // so a line whose reveal never scroll-latched (collapsed subgroup) can
    // reveal again when the user clicks back to it. Same-line re-renders keep
    // the latch, which is what prevents the toggle lock-out / snap-back.
    if (this._revealedLine !== null && this._revealedLine !== selectedLine) {
      this._revealedLine = null;
    }
    if (selectedLine === this._scrolledLine) return;
    const index = sectionIndexForLine(buckets, selectedLine);
    if (index === -1) {
      // No navigator row for this line (e.g. an unscoped automation); latch so
      // we don't re-scan the buckets on every later update.
      this._scrolledLine = selectedLine;
      return;
    }
    if (!filtering && !openSections.has(index) && this._revealedLine !== selectedLine) {
      // Ask the page to open it once, then bail; the re-render re-enters with
      // the row. Latch *before* dispatch (below) so a manual re-close of this
      // section can't re-trigger the forced open on a later render.
      this._revealedLine = selectedLine;
      this._host.dispatchEvent(
        new CustomEvent("section-reveal", {
          detail: { index },
          bubbles: true,
          composed: true,
        })
      );
      return;
    }
    // Past the reveal gate: the section is already open (URL ``open=`` restore,
    // accordion), we're filtering, or we already asked once. Latch the line
    // here too — without it a section opened by URL never marks the line
    // handled, so closing it (by opening another section) re-fires the reveal
    // and snaps it back open.
    this._revealedLine = selectedLine;
    // Latch only on a confirmed scroll so the reveal retries when the row
    // becomes scrollable: querySelector misses a row that isn't rendered yet
    // (collapsed Components subgroup), and getClientRects catches one that is
    // rendered but has no layout box (display:none collapsed desktop nav).
    const row = this._host.renderRoot.querySelector(".nav-item--selected");
    if (row && row.getClientRects().length > 0) {
      row.scrollIntoView({ block: "nearest" });
      this._scrolledLine = selectedLine;
    }
  }
}
