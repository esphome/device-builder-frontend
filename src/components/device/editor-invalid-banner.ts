/**
 * Document-level "configuration invalid" banner for the YAML editor.
 *
 * Renders the live lint errors below the code pane, in flow — the editor
 * shrinks to make room, so the banner can never cover the line it is
 * complaining about (an error at EOF has no scroll room to escape an
 * overlay).
 *
 * The reveal is damped so the banner doesn't pop over a half-typed token:
 * while the editor is focused and every error — parse or validation — is
 * anchored within NEAR_CARET_LINES of the caret, new errors stay
 * squiggle-only until the caret moves away, the editor loses focus, or
 * the user has been idle for REVEAL_IDLE_MS. An error anchored far from
 * the caret, or a line-less validation error (whole-config breakage like
 * a missing platform), shows as soon as the lint pass lands — except
 * while the completion popup is open, which holds every reveal. A fixed
 * config clears the banner immediately; a banner already on screen
 * tracks lint updates live.
 */
import { consume } from "@lit/context";
import { mdiAlertCircleOutline } from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { dangerBannerStyles } from "../../styles/banners.js";
import { renderTextLinks } from "../../util/markdown.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import type { BannerError, YamlAutoFix } from "../../util/yaml-lint-backend.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "alert-circle-outline": mdiAlertCircleOutline,
});

/** Cap the errors listed in the banner; the rest collapse to "+N more". */
const MAX_BANNER_ERRORS = 6;

/** Caret distance (lines) within which a new error reads as the token the
 *  user is mid-way through typing. PyYAML blames the line where parsing
 *  broke, often one or two lines below the caret's half-typed key. */
const NEAR_CARET_LINES = 3;

/** Idle backstop: reveal a suppressed banner after this long with no edit. */
const REVEAL_IDLE_MS = 15_000;

/** Detail of the banner-auto-fix event: the clicked error's repair. */
export interface BannerAutoFixDetail {
  fix: YamlAutoFix;
}

/** Detail of the banner-goto-line event: the clicked error's 1-indexed line. */
export interface BannerGotoLineDetail {
  line: number;
}

@customElement("esphome-editor-invalid-banner")
export class ESPHomeEditorInvalidBanner extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** Live lint errors from the host's backend linter. */
  @property({ attribute: false })
  errors: BannerError[] = [];

  /** Caret's current 1-indexed line, for the near-caret suppression. */
  @property({ type: Number })
  caretLine = 0;

  /** Whether the YAML editor currently holds focus. */
  @property({ type: Boolean })
  editorFocused = false;

  /** The completion popup is open — the user is mid-decision, so every
   *  reveal (including line-less validation errors) holds until it closes. */
  @property({ type: Boolean })
  completionOpen = false;

  /** Timestamp accessor (performance.now clock) of the last YAML edit — a
   *  pull accessor so the host doesn't re-render per keystroke. -Infinity
   *  means "never typed": the idle backstop is already satisfied. */
  @property({ attribute: false })
  getLastEditAt: () => number = () => Number.NEGATIVE_INFINITY;

  /** The errors actually on screen; empty renders nothing (the host's
   *  display: contents means no flex box and no pane gap either). */
  @state()
  private _visible: BannerError[] = [];

  private _revealTimer: ReturnType<typeof setTimeout> | undefined;

  static styles = [
    dangerBannerStyles,
    css`
      :host {
        display: contents;
      }

      .invalid-banner {
        flex: 0 0 auto;
      }

      .invalid-banner-goto {
        appearance: none;
        margin-left: 0.35em;
        padding: 0;
        border: none;
        background: none;
        color: inherit;
        font: inherit;
        font-weight: var(--wa-font-weight-semibold);
        text-decoration: underline;
        cursor: pointer;
        white-space: nowrap;
      }

      .invalid-banner-goto:hover {
        text-decoration: none;
      }

      .invalid-banner-more {
        font-size: var(--wa-font-size-2xs);
        opacity: 0.85;
      }
    `,
  ];

  willUpdate(changed: Map<string, unknown>) {
    if (
      changed.has("errors") ||
      changed.has("caretLine") ||
      changed.has("editorFocused") ||
      changed.has("completionOpen")
    ) {
      this._evaluate();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._cancelRevealTimer();
  }

  protected render() {
    if (this._visible.length === 0) return nothing;
    return html`<div class="danger-banner invalid-banner" role="alert">
      <wa-icon library="mdi" name="alert-circle-outline"></wa-icon>
      <div class="danger-banner-text">
        ${this._visible.slice(0, MAX_BANNER_ERRORS).map(
          (err) =>
            html`<span
              >${renderTextLinks(err.message)}${
                err.fix
                  ? html`
                      <button
                        type="button"
                        class="invalid-banner-goto"
                        title=${this._localize("yaml_editor.error_auto_fix_hint")}
                        @click=${() => this._onAutoFix(err.fix!)}
                      >
                        ${this._localize("yaml_editor.error_auto_fix")}
                      </button>
                    `
                  : nothing
              }${
                err.line
                  ? html`
                      <button
                        type="button"
                        class="invalid-banner-goto"
                        @click=${() => this._onGotoLine(err.line!)}
                      >
                        ${this._localize("yaml_editor.error_go_to_line", {
                          line: err.line,
                        })}
                      </button>
                    `
                  : nothing
              }</span
            >`
        )}
        ${
          this._visible.length > MAX_BANNER_ERRORS
            ? html`<span class="invalid-banner-more"
                >${this._localize("device.editor_invalid_more", {
                  count: this._visible.length - MAX_BANNER_ERRORS,
                })}</span
              >`
            : nothing
        }
      </div>
    </div>`;
  }

  private _onAutoFix(fix: YamlAutoFix) {
    this.dispatchEvent(
      new CustomEvent<BannerAutoFixDetail>("banner-auto-fix", {
        detail: { fix },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onGotoLine(line: number) {
    this.dispatchEvent(
      new CustomEvent<BannerGotoLineDetail>("banner-goto-line", {
        detail: { line },
        bubbles: true,
        composed: true,
      })
    );
  }

  /** Settle _visible against the current inputs, (re)arming the idle
   *  timer when the only path left to reveal is the user going idle. */
  private _evaluate() {
    if (this.errors.length === 0) {
      this._cancelRevealTimer();
      if (this._visible.length) this._visible = [];
      return;
    }
    if (this._visible.length > 0 || this._shouldReveal()) {
      this._cancelRevealTimer();
      this._visible = this.errors;
      return;
    }
    // The completion popup holds reveals without a deadline; closing it
    // re-evaluates through the property change, so no timer churns while
    // it stays open.
    if (this.completionOpen) {
      this._cancelRevealTimer();
      return;
    }
    this._armRevealTimer();
  }

  private _shouldReveal(): boolean {
    // An open completion popup means the user is still picking — hold
    // everything; closing it re-evaluates through the property change.
    if (this.completionOpen) return false;
    if (!this.editorFocused) return true;
    // A line-less validation error is whole-config breakage (a deleted
    // esp32: block, an included-file error) — nothing ties it to what the
    // user is typing, so show it right away. Anything anchored near the
    // caret is plausibly the half-typed token, whether the parser or the
    // validator complained (a lone "l" under "logger:" parses as a string
    // and surfaces as "expected a dictionary."), so it stays damped. A
    // line-less PARSE error is an unplaceable artifact of mid-edit YAML —
    // suppressible.
    if (this.errors.some((err) => err.kind !== "parse" && err.line === undefined)) {
      return true;
    }
    if (
      this.errors.some(
        (err) =>
          err.line !== undefined && Math.abs(err.line - this.caretLine) > NEAR_CARET_LINES
      )
    ) {
      return true;
    }
    return performance.now() - this.getLastEditAt() >= REVEAL_IDLE_MS;
  }

  /** The timer re-evaluates rather than reveals: the idle clock restarts
   *  with every keystroke (and a deduped identical lint result never
   *  reassigns the errors prop), so on fire the remaining idle is re-measured and
   *  the timer re-armed until a full quiet window has actually elapsed. */
  private _armRevealTimer() {
    this._cancelRevealTimer();
    const remaining = REVEAL_IDLE_MS - (performance.now() - this.getLastEditAt());
    this._revealTimer = setTimeout(
      () => {
        this._revealTimer = undefined;
        this._evaluate();
      },
      Math.max(remaining, 100)
    );
  }

  private _cancelRevealTimer() {
    if (this._revealTimer !== undefined) {
      clearTimeout(this._revealTimer);
      this._revealTimer = undefined;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-editor-invalid-banner": ESPHomeEditorInvalidBanner;
  }
}
