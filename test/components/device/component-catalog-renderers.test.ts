// @vitest-environment happy-dom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import type { FeaturedBundle } from "../../../src/api/types/boards.js";
import {
  ComponentCategory,
  type ComponentCatalogEntry,
} from "../../../src/api/types/components.js";
import type { ESPHomeComponentCatalog } from "../../../src/components/device/component-catalog.js";
import {
  renderBundleCard,
  renderCard,
  shouldHandleCardClick,
} from "../../../src/components/device/component-catalog/renderers.js";

function clickFrom(target: Element): MouseEvent {
  const ev = new MouseEvent("click", { bubbles: true });
  Object.defineProperty(ev, "target", { value: target });
  return ev;
}

function makeHost(): ESPHomeComponentCatalog {
  return {
    _imageFailed: new Set<string>(),
    _overflowingDescriptions: new Set<string>(),
    _category: "all",
    board: { name: "Guition Smart Screen" },
    _localize: localize,
    _onAdd: () => {},
    _onAddBundle: () => {},
    _onToggleExpand: () => {},
    _onImageError: () => {},
  } as unknown as ESPHomeComponentCatalog;
}

function makeEntry(overrides: Partial<ComponentCatalogEntry>): ComponentCatalogEntry {
  return {
    id: "spi",
    name: "SPI Bus",
    description: "",
    category: ComponentCategory.BUS,
    docs_url: "",
    image_url: "",
    ...overrides,
  } as ComponentCatalogEntry;
}

function makeBundle(): FeaturedBundle {
  return {
    id: "rgb_buzzer_module",
    name: "RGB LED + Buzzer Module",
    description: "The starter kit's RGB + Buzzer module.",
    component_ids: ["rgb_leds", "buzzer_output"],
  };
}

const localize = (key: string, values?: Record<string, string | number>) => {
  if (key === "device.component_category_featured") return "Recommended";
  if (key === "device.recommended_chip_tooltip")
    return `Pre-configured for the ${values?.board}`;
  return key;
};

describe("renderCard", () => {
  it("marks a featured card with the Recommended chip plus its real category", () => {
    const container = document.createElement("div");
    const entry = makeEntry({
      id: "featured.board.lcd_spi",
      category: ComponentCategory.FEATURED,
      underlying_category: ComponentCategory.BUS,
    });
    render(renderCard(makeHost(), entry, false, true, localize), container);
    const chip = container.querySelector(".component-category-chip--recommended");
    expect(chip?.textContent?.trim()).toBe("Recommended");
    // Focusable so keyboard users can raise the tooltip (focus trigger).
    expect(chip?.getAttribute("tabindex")).toBe("0");
    // Native title tooltips don't render inside the dialog's top layer,
    // so the explanation rides a wa-tooltip targeting the chip's id.
    const tooltip = container.querySelector("wa-tooltip");
    expect(tooltip?.getAttribute("for")).toBe(chip?.id);
    expect(tooltip?.textContent?.trim()).toBe(
      "Pre-configured for the Guition Smart Screen"
    );
    const chips = [...container.querySelectorAll(".component-category-chip")].map((c) =>
      c.textContent?.trim()
    );
    expect(chips).toEqual(["Recommended", "Bus"]);
    expect(container.querySelector(".component-card--featured")).not.toBeNull();
  });

  it("omits the tooltip until the board body has hydrated", () => {
    const container = document.createElement("div");
    const host = makeHost();
    (host as unknown as { board: null }).board = null;
    const entry = makeEntry({
      id: "featured.board.lcd_spi",
      category: ComponentCategory.FEATURED,
    });
    render(renderCard(host, entry, false, true, localize), container);
    const chip = container.querySelector(".component-category-chip--recommended");
    expect(chip).not.toBeNull();
    expect(container.querySelector("wa-tooltip")).toBeNull();
    // No tooltip to raise — the chip must not be a dead tab stop.
    expect(chip?.getAttribute("tabindex")).toBe("-1");
  });

  it("keeps the muted category chip on a regular card", () => {
    const container = document.createElement("div");
    render(renderCard(makeHost(), makeEntry({}), false, false, localize), container);
    expect(container.querySelector(".component-category-chip--recommended")).toBeNull();
    expect(container.querySelector(".component-category-chip")?.textContent).toBe("Bus");
  });

  it("omits the expand button when the description doesn't overflow its clamp", () => {
    // Expanding only unclamps the description, so a fitting (or empty)
    // description makes the button pure dead UI.
    const container = document.createElement("div");
    render(renderCard(makeHost(), makeEntry({}), false, false, localize), container);
    expect(container.querySelector(".expand-button")).toBeNull();
  });

  it("shows the expand button when the clamped description overflows", () => {
    const container = document.createElement("div");
    const host = makeHost();
    (host._overflowingDescriptions as Set<string>).add("spi");
    render(renderCard(host, makeEntry({}), false, false, localize), container);
    expect(container.querySelector(".expand-button")).not.toBeNull();
  });

  it("keeps the collapse button on an expanded card", () => {
    // Once open, the unclamped text no longer measures as overflowing; the
    // card still needs its collapse affordance.
    const container = document.createElement("div");
    render(renderCard(makeHost(), makeEntry({}), true, false, localize), container);
    const button = container.querySelector(".expand-button");
    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-pressed")).toBe("true");
  });

  it("stamps the component id on the description for overflow measurement", () => {
    const container = document.createElement("div");
    render(renderCard(makeHost(), makeEntry({}), false, false, localize), container);
    const description = container.querySelector<HTMLElement>(".component-description");
    expect(description?.dataset.componentId).toBe("spi");
    expect(description?.classList.contains("component-description--clamp")).toBe(true);
  });
});

describe("renderBundleCard", () => {
  it("marks the bundle with the Recommended chip beside the Bundle badge", () => {
    const container = document.createElement("div");
    render(renderBundleCard(makeHost(), makeBundle()), container);
    const chip = container.querySelector(".component-category-chip--recommended");
    expect(chip?.textContent?.trim()).toBe("Recommended");
    // Focusable so keyboard users can raise the tooltip (focus trigger).
    expect(chip?.getAttribute("tabindex")).toBe("0");
    const tooltip = container.querySelector("wa-tooltip");
    expect(tooltip?.getAttribute("for")).toBe(chip?.id);
    expect(tooltip?.textContent?.trim()).toBe(
      "Pre-configured for the Guition Smart Screen"
    );
    expect(container.querySelector(".bundle-badge")).not.toBeNull();
    expect(container.querySelector(".component-card--featured")).not.toBeNull();
  });

  it("omits the tooltip until the board body has hydrated", () => {
    const container = document.createElement("div");
    const host = makeHost();
    (host as unknown as { board: null }).board = null;
    render(renderBundleCard(host, makeBundle()), container);
    const chip = container.querySelector(".component-category-chip--recommended");
    expect(chip).not.toBeNull();
    expect(container.querySelector("wa-tooltip")).toBeNull();
    // No tooltip to raise — the chip must not be a dead tab stop.
    expect(chip?.getAttribute("tabindex")).toBe("-1");
  });
});

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
