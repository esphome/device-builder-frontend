// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { shouldHandleCardClick } from "../../../src/components/device/component-catalog/renderers.js";

function clickFrom(target: Element): MouseEvent {
  const ev = new MouseEvent("click", { bubbles: true });
  Object.defineProperty(ev, "target", { value: target });
  return ev;
}

describe("shouldHandleCardClick", () => {
  it("adds when the click landed on a non-interactive part of the card", () => {
    // Card surface (description text, image, header, etc.) is the
    // primary motivation for the article-level handler — issue #778.
    const card = document.createElement("article");
    const description = document.createElement("p");
    card.append(description);
    expect(shouldHandleCardClick(clickFrom(description))).toBe(true);
  });

  it("skips when the click landed on the inner + Add button", () => {
    // The "+ Add" indicator is a real <button> so keyboard users
    // can tab + Enter; the article-level handler must defer to its
    // own onAdd to avoid a double-add.
    const card = document.createElement("article");
    const addButton = document.createElement("button");
    card.append(addButton);
    expect(shouldHandleCardClick(clickFrom(addButton))).toBe(false);
  });

  it("skips when the click landed inside the inner + Add button", () => {
    // The button contains a <wa-icon> child — the click target is
    // the icon, not the button. closest() must walk up to find it.
    const card = document.createElement("article");
    const addButton = document.createElement("button");
    const icon = document.createElement("wa-icon");
    addButton.append(icon);
    card.append(addButton);
    expect(shouldHandleCardClick(clickFrom(icon))).toBe(false);
  });

  it("skips when the click landed on the more-info anchor", () => {
    // External docs link must navigate, not add.
    const card = document.createElement("article");
    const moreInfo = document.createElement("a");
    moreInfo.href = "https://example.test/docs";
    card.append(moreInfo);
    expect(shouldHandleCardClick(clickFrom(moreInfo))).toBe(false);
  });

  it("skips when the click landed on a markdown link inside the description", () => {
    // Catalog descriptions render embedded [text](url) as <a>;
    // those should navigate without triggering add.
    const card = document.createElement("article");
    const description = document.createElement("p");
    const mdLink = document.createElement("a");
    mdLink.href = "https://example.test/rest-api";
    description.append(mdLink);
    card.append(description);
    expect(shouldHandleCardClick(clickFrom(mdLink))).toBe(false);
  });

  it("skips when the click landed on the expand button", () => {
    // Toggling the expanded view is its own action; the card
    // surface around the expand icon still adds.
    const card = document.createElement("article");
    const expandButton = document.createElement("button");
    card.append(expandButton);
    expect(shouldHandleCardClick(clickFrom(expandButton))).toBe(false);
  });

  it("does not crash when ev.target is null", () => {
    // ev.target is `EventTarget | null` per the DOM types — the
    // optional chain has to tolerate the null branch.
    const ev = new MouseEvent("click");
    Object.defineProperty(ev, "target", { value: null });
    expect(shouldHandleCardClick(ev)).toBe(true);
  });
});
