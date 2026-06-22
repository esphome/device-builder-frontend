/**
 * @vitest-environment happy-dom
 *
 * Pins the anchor wiring the two autolink consumers emit: the security
 * contract (target/rel, no innerHTML) lives here, not in the splitTextLinks
 * unit tests. renderMessageNode feeds the CodeMirror lint tooltip;
 * renderTextLinks feeds the configuration-invalid banner.
 */

import { render } from "lit";
import { describe, expect, it } from "vitest";

import { renderTextLinks } from "../../src/util/markdown.js";
import { renderMessageNode } from "../../src/util/yaml-lint-backend.js";

const MSG = "check the list at https://example.com/tz.";

describe("renderMessageNode", () => {
  it("wires a new-tab anchor with the noopener rel", () => {
    const anchor = renderMessageNode(MSG).querySelector("a")!;
    expect(anchor.getAttribute("href")).toBe("https://example.com/tz");
    expect(anchor.textContent).toBe("https://example.com/tz");
    expect(anchor.target).toBe("_blank");
    expect(anchor.rel).toBe("noopener noreferrer");
    expect(anchor.className).toBe("cm-diagnostic-link");
  });

  it("keeps surrounding prose as text nodes, not markup", () => {
    const span = renderMessageNode(MSG);
    // Lead text, the anchor, then the trailing period; the period must be a
    // bare text node so a future innerHTML swap would visibly break this.
    expect(span.childNodes[0]).toBeInstanceOf(Text);
    expect(span.childNodes[0].textContent).toBe("check the list at ");
    const tail = span.childNodes[span.childNodes.length - 1];
    expect(tail).toBeInstanceOf(Text);
    expect(tail.textContent).toBe(".");
  });

  it("emits no anchor when there is no URL", () => {
    expect(renderMessageNode("plain text").querySelector("a")).toBeNull();
  });
});

describe("renderTextLinks", () => {
  it("renders a new-tab md-link anchor in a Lit template", () => {
    const host = document.createElement("div");
    render(renderTextLinks(MSG), host);
    const anchor = host.querySelector("a")!;
    expect(anchor.getAttribute("href")).toBe("https://example.com/tz");
    expect(anchor.target).toBe("_blank");
    expect(anchor.rel).toBe("noopener noreferrer");
    expect(anchor.className).toBe("md-link");
  });

  it("renders nothing for empty input", () => {
    const host = document.createElement("div");
    render(renderTextLinks(""), host);
    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).toBe("");
  });
});
