/**
 * @vitest-environment happy-dom
 *
 * Unit coverage for the shared term-button render helpers used by the command
 * and logs dialog toolbars.
 */
import type { TemplateResult } from "lit";
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import {
  renderTermButton,
  renderTermToggle,
} from "../../../src/components/process-terminal/toolbar-button.js";

function mount(tpl: TemplateResult): HTMLButtonElement {
  const container = document.createElement("div");
  render(tpl, container);
  return container.querySelector("button")!;
}

describe("renderTermButton", () => {
  it("renders the variant class, icon + label, and wires onClick", () => {
    const onClick = vi.fn();
    const btn = mount(
      renderTermButton({ icon: "stop", label: "Stop", variant: "stop", onClick })
    );
    expect(btn.className).toContain("term-btn");
    expect(btn.className).toContain("term-btn--stop");
    expect(btn.querySelector("wa-icon")?.getAttribute("name")).toBe("stop");
    expect(btn.textContent).toContain("Stop");
    btn.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("wraps the label in a .term-btn__label span so mobile can collapse it to icon-only", () => {
    const btn = mount(
      renderTermButton({ icon: "restart", label: "Reset device", onClick: () => {} })
    );
    const label = btn.querySelector(".term-btn__label");
    expect(label?.textContent).toBe("Reset device");
    // Icon stays a sibling of the (collapsible) label, not inside it.
    expect(label?.querySelector("wa-icon")).toBeNull();
    expect(btn.querySelector("wa-icon")?.getAttribute("name")).toBe("restart");
  });

  it("marks icon buttons with term-btn--with-icon so only they collapse on mobile", () => {
    const withIcon = mount(
      renderTermButton({ icon: "stop", label: "Stop", onClick: () => {} })
    );
    expect(withIcon.className).toContain("term-btn--with-icon");
    // Icon-less buttons (Close) keep their label and must not be collapsed.
    const iconless = mount(renderTermButton({ label: "Close", onClick: () => {} }));
    expect(iconless.className).not.toContain("term-btn--with-icon");
  });

  it("uses title as the accessible name for an icon-only button", () => {
    const btn = mount(
      renderTermButton({ icon: "download", title: "Download", onClick: () => {} })
    );
    expect(btn.getAttribute("title")).toBe("Download");
    expect(btn.getAttribute("aria-label")).toBe("Download");
  });

  it("defaults to ghost, omits aria-pressed, and reflects disabled", () => {
    const btn = mount(
      renderTermButton({ label: "Close", disabled: true, onClick: () => {} })
    );
    expect(btn.className).toContain("term-btn--ghost");
    expect(btn.hasAttribute("aria-pressed")).toBe(false);
    expect(btn.hasAttribute("disabled")).toBe(true);
  });
});

describe("renderTermToggle", () => {
  const opts = {
    onClick: () => {},
    iconActive: "key",
    iconInactive: "key-outline",
    labelActive: "Hide",
    labelInactive: "Show",
    title: "Toggle secrets",
  };

  it("reflects the active state via is-active + aria-pressed and the active icon/label", () => {
    const btn = mount(renderTermToggle({ ...opts, active: true }));
    expect(btn.className).toContain("is-active");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.querySelector("wa-icon")?.getAttribute("name")).toBe("key");
    expect(btn.textContent).toContain("Hide");
  });

  it("renders the inactive icon/label when off", () => {
    const btn = mount(renderTermToggle({ ...opts, active: false }));
    expect(btn.className).not.toContain("is-active");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(btn.querySelector("wa-icon")?.getAttribute("name")).toBe("key-outline");
    expect(btn.textContent).toContain("Show");
  });
});
