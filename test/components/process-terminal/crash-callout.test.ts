// @vitest-environment happy-dom
import { html, nothing } from "lit";
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));

import { renderCrashCallout } from "../../../src/components/process-terminal/crash-callout.js";
import type { CrashKind } from "../../../src/util/crash-detector.js";
import { identityLocalize, renderInto } from "../../_dom.js";

function mount(kind: CrashKind | null, action?: ReturnType<typeof html>): HTMLElement {
  return renderInto(renderCrashCallout(identityLocalize, kind, action));
}

describe("renderCrashCallout", () => {
  it("renders nothing while no crash is latched", () => {
    expect(renderCrashCallout(identityLocalize, null)).toBe(nothing);
    expect(mount(null).querySelector(".crash-callout")).toBeNull();
  });

  it("picks the banner key per crash kind", () => {
    expect(mount("live").querySelector(".crash-callout-text")!.textContent).toContain(
      "crash_report.banner"
    );
    expect(
      mount("previous-boot").querySelector(".crash-callout-text")!.textContent!.trim()
    ).toBe("crash_report.banner_previous_boot");
  });

  it("puts the live region on the text span, not the row, and hides the icon", () => {
    const container = mount("live");
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.classList.contains("crash-callout-text")).toBe(true);
    expect(container.querySelector(".crash-callout")!.hasAttribute("role")).toBe(false);
    expect(container.querySelector("wa-icon")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders the consumer's action inside the row when supplied", () => {
    const container = mount(
      "live",
      html`<button class="crash-callout-button">report</button>`
    );
    expect(
      container.querySelector(".crash-callout .crash-callout-button")
    ).not.toBeNull();
    expect(mount("live").querySelector(".crash-callout-button")).toBeNull();
  });
});
