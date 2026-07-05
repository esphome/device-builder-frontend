/**
 * @vitest-environment happy-dom
 *
 * Renders renderMarkdown to real DOM. ESPHome docstrings bold-wrap links
 * (`**[Action](url)**:`); the inline renderer must recurse one level so the
 * link inside the bold stays clickable instead of leaking as literal text.
 */

import { describe, expect, it } from "vitest";

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
