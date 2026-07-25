import { html, nothing } from "lit";
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));

import {
  renderCrashCallout,
  crashCalloutStyles,
} from "../../../src/components/process-terminal/crash-callout.js";
import { findTemplatesByAnchor } from "../../_lit-template-walker.js";

const localize = (key: string) => key;

describe("renderCrashCallout", () => {
  it("renders nothing while no crash is latched", () => {
    expect(renderCrashCallout(localize, null)).toBe(nothing);
  });

  it("picks the banner key per crash kind", () => {
    const live = renderCrashCallout(localize, "live");
    expect(findTemplatesByAnchor(live, 'class="crash-callout"')[0].values).toContain(
      "crash_report.banner"
    );
    const previous = renderCrashCallout(localize, "previous-boot");
    expect(findTemplatesByAnchor(previous, 'class="crash-callout"')[0].values).toContain(
      "crash_report.banner_previous_boot"
    );
  });

  it("puts the live region on the text span, not the row", () => {
    const tree = renderCrashCallout(localize, "live");
    const [callout] = findTemplatesByAnchor(tree, 'class="crash-callout"');
    const statics = callout.strings.join("");
    expect(statics).toContain('class="crash-callout-text" role="status"');
    expect(statics).not.toMatch(/crash-callout" [^>]*role=/);
  });

  it("renders the consumer's action after the text when supplied", () => {
    const action = html`<button class="crash-callout-button">report</button>`;
    const tree = renderCrashCallout(localize, "live", action);
    const [callout] = findTemplatesByAnchor(tree, 'class="crash-callout"');
    expect(callout.values).toContain(action);
  });

  it("exports the container styles both dialogs compose", () => {
    expect(crashCalloutStyles.cssText).toContain(".crash-callout");
  });
});
