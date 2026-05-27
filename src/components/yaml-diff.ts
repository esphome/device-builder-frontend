import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { darkModeContext, localizeContext } from "../context/index.js";
import { diffLines, type DiffLine } from "../util/diff-lines.js";

@customElement("esphome-yaml-diff")
export class ESPHomeYamlDiff extends LitElement {
  @consume({ context: darkModeContext, subscribe: true })
  @state()
  private _darkMode = false;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property() oldValue = "";

  @property() newValue = "";

  static styles = css`
    :host {
      display: block;
      flex: 1;
      min-height: 0;
      position: relative;
      overflow: auto;
      font-family: "JetBrains Mono", "Fira Code", monospace;
      font-size: 13px;
      line-height: 1.5;
      background: var(--diff-bg);
      color: var(--diff-fg);
      --diff-bg: #ffffff;
      --diff-fg: #1f2328;
      --diff-gutter-bg: #f6f8fa;
      --diff-gutter-fg: #6e7781;
      --diff-add-bg: #e6ffec;
      --diff-add-marker-bg: #abf2bc;
      --diff-add-fg: #1a7f37;
      --diff-remove-bg: #ffebe9;
      --diff-remove-marker-bg: #ffcecb;
      --diff-remove-fg: #cf222e;
      --diff-empty-fg: #8c959f;
    }

    :host([dark]) {
      --diff-bg: #0d1117;
      --diff-fg: #e6edf3;
      --diff-gutter-bg: #161b22;
      --diff-gutter-fg: #7d8590;
      --diff-add-bg: #033a16;
      --diff-add-marker-bg: #1a7f37;
      --diff-add-fg: #aff5b4;
      --diff-remove-bg: #67060c;
      --diff-remove-marker-bg: #b62324;
      --diff-remove-fg: #ffcecb;
      --diff-empty-fg: #6e7681;
    }

    .empty {
      padding: var(--wa-space-l);
      text-align: center;
      color: var(--diff-empty-fg);
      font-family: var(--wa-font-family-body);
      font-size: var(--wa-font-size-s);
    }

    table {
      border-collapse: collapse;
      width: 100%;
      table-layout: fixed;
    }

    tr {
      vertical-align: top;
    }

    .gutter {
      width: 1em;
      padding: 0 8px;
      padding-right: 14px;
      text-align: right;
      background: var(--diff-gutter-bg);
      color: var(--diff-gutter-fg);
      user-select: none;
      white-space: nowrap;
    }

    .marker {
      width: 1.5em;
      padding: 0 6px;
      text-align: center;
      user-select: none;
      font-weight: 600;
      border-right: 1px solid color-mix(in srgb, var(--diff-fg), transparent 90%);
    }

    .content {
      padding: 0 8px;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: anywhere;
      font-variant-ligatures: none;
    }

    tr.add .marker,
    tr.add .content {
      background: var(--diff-add-bg);
      color: var(--diff-add-fg);
    }

    tr.add .marker {
      background: var(--diff-add-marker-bg);
    }

    tr.remove .marker,
    tr.remove .content {
      background: var(--diff-remove-bg);
      color: var(--diff-remove-fg);
    }

    tr.remove .marker {
      background: var(--diff-remove-marker-bg);
    }
  `;

  protected render() {
    if (this._darkMode) {
      this.setAttribute("dark", "");
    } else {
      this.removeAttribute("dark");
    }

    if (this.oldValue === this.newValue) {
      return html`<div class="empty">${this._localize("device.diff_no_changes")}</div>`;
    }

    const lines = diffLines(this.oldValue, this.newValue);

    return html`
      <table>
        <tbody>
          ${lines.map((line) => this._renderLine(line))}
        </tbody>
      </table>
    `;
  }

  private _renderLine(line: DiffLine) {
    const marker = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
    const lineNumber = line.type === "remove" ? line.oldLine : line.newLine;
    return html`
      <tr class=${line.type}>
        <td class="gutter">${lineNumber ?? html`&nbsp;`}</td>
        <td class="marker">${marker}</td>
        <td class="content">${line.content || nothing}</td>
      </tr>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-yaml-diff": ESPHomeYamlDiff;
  }
}
