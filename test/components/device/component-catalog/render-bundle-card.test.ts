// @vitest-environment happy-dom
//
// Tests for renderBundleCard image handling: a featured bundle with an
// image_url shows the module photo; without one (or once it has failed to
// load) it falls back to the box-icon placeholder.

import { describe, expect, it } from "vitest";

import type { FeaturedBundle } from "../../../../src/api/types/boards.js";
import { renderBundleCard } from "../../../../src/components/device/component-catalog/renderers.js";
import { identityLocalize, renderInto } from "../../../_dom.js";

function host(failed: string[] = []): unknown {
  return {
    _imageFailed: new Set(failed),
    _onAddBundle: () => {},
    _onImageError: () => {},
    _localize: identityLocalize,
  };
}

function bundle(overrides: Partial<FeaturedBundle> = {}): FeaturedBundle {
  return {
    id: "rgb_buzzer_module",
    name: "RGB LED + Buzzer Module",
    description: "",
    component_ids: ["rgb_leds", "buzzer_output"],
    ...overrides,
  };
}

describe("renderBundleCard image", () => {
  it("renders the module image when the bundle has an image_url", () => {
    const b = bundle({ image_url: "https://example.com/module.jpg" });
    const el = renderInto(renderBundleCard(host() as never, b));
    const img = el.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://example.com/module.jpg");
    expect(el.querySelector(".component-image--placeholder")).toBeNull();
  });

  it("falls back to the box-icon placeholder without an image_url", () => {
    const el = renderInto(renderBundleCard(host() as never, bundle()));
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector(".component-image--placeholder")).not.toBeNull();
  });

  it("falls back to the placeholder once the image has failed to load", () => {
    const b = bundle({ image_url: "https://example.com/module.jpg" });
    const el = renderInto(renderBundleCard(host([b.id]) as never, b));
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector(".component-image--placeholder")).not.toBeNull();
  });

  it("calls _onImageError with the bundle id when the img fires an error", () => {
    const failedIds: string[] = [];
    const spyHost = {
      _imageFailed: new Set<string>(),
      _onAddBundle: () => {},
      _onImageError: (id: string) => failedIds.push(id),
      _localize: identityLocalize,
    };
    const b = bundle({ image_url: "https://example.com/module.jpg" });
    const el = renderInto(renderBundleCard(spyHost as never, b));
    el.querySelector("img")!.dispatchEvent(new Event("error"));
    expect(failedIds).toEqual([b.id]);
  });
});
