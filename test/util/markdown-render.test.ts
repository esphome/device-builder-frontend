/**
 * @vitest-environment happy-dom
 *
 * Renders renderMarkdown to real DOM. ESPHome docstrings bold-wrap links
 * (`**[Action](url)**:`); the inline renderer must recurse one level so the
 * link inside the bold stays clickable instead of leaking as literal text.
 */

import { describe, expect, it, vi } from "vitest";

import { renderMarkdown } from "../../src/util/markdown.js";
import { renderInto } from "../_dom.js";

describe("renderMarkdown — bold-wrapped inline formatting", () => {
  it("renders a link inside bold as a clickable anchor", () => {
    const host = renderInto(
      renderMarkdown("**[Action](https://esphome.io/x)**: do a thing")
    );
    const strong = host.querySelector("strong")!;
    const anchor = strong.querySelector("a.md-link")!;
    expect(anchor.getAttribute("href")).toBe("https://esphome.io/x");
    expect(anchor.textContent).toBe("Action");
    expect(anchor.getAttribute("target")).toBe("_blank");
    expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
    expect(host.textContent).toBe("Action: do a thing");
  });

  it("renders a link inside italic as a clickable anchor", () => {
    const host = renderInto(renderMarkdown("_[Action](https://esphome.io/x)_"));
    const anchor = host.querySelector("em a.md-link")!;
    expect(anchor.getAttribute("href")).toBe("https://esphome.io/x");
    expect(anchor.textContent).toBe("Action");
  });

  it("renders code inside bold", () => {
    const host = renderInto(renderMarkdown("**`true`**"));
    const code = host.querySelector("strong code.md-code")!;
    expect(code.textContent).toBe("true");
  });

  it("keeps plain bold as bold with no anchor", () => {
    const host = renderInto(renderMarkdown("**plain bold**"));
    expect(host.querySelector("strong")!.textContent).toBe("plain bold");
    expect(host.querySelector("a")).toBeNull();
  });

  it("does not make a bold-wrapped unsafe link clickable", () => {
    const host = renderInto(renderMarkdown("**[x](javascript:void)**"));
    expect(host.querySelector("a")).toBeNull();
    expect(host.querySelector("strong")!.textContent).toBe("x");
  });
});

describe("renderMarkdown — unwrapped link still works", () => {
  it("renders a bare markdown link as an anchor", () => {
    const host = renderInto(renderMarkdown("[Action](https://esphome.io/x)"));
    const anchor = host.querySelector("a.md-link")!;
    expect(anchor.getAttribute("href")).toBe("https://esphome.io/x");
    expect(anchor.textContent).toBe("Action");
  });
});

describe("renderMarkdown — codeLink option", () => {
  it("renders a resolved code span as a button and fires the handler on click", () => {
    const onClick = vi.fn();
    const host = renderInto(
      renderMarkdown("Pair with `captive_portal:` or `web_server:`", {
        codeLink: (text) => (text === "captive_portal:" ? onClick : null),
      })
    );
    const button = host.querySelector<HTMLButtonElement>("button.md-code.md-code-link")!;
    expect(button.getAttribute("type")).toBe("button");
    expect(button.textContent).toBe("captive_portal:");
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    // The declined span stays a plain code chip.
    const codes = host.querySelectorAll("code.md-code");
    expect(codes).toHaveLength(1);
    expect(codes[0].textContent).toBe("web_server:");
  });

  it("links a bold-wrapped code span through the recursion", () => {
    const onClick = vi.fn();
    const host = renderInto(renderMarkdown("**`wifi:`**", { codeLink: () => onClick }));
    const button = host.querySelector<HTMLButtonElement>("strong button.md-code-link")!;
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders plain code chips with no options", () => {
    const host = renderInto(renderMarkdown("`captive_portal:`"));
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector("code.md-code")!.textContent).toBe("captive_portal:");
  });
});
