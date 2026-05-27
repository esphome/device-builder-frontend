import { describe, expect, it } from "vitest";
import { isEmptyToPopulatedYamlChange } from "../../../src/components/device/device-board-info-helpers.js";

describe("isEmptyToPopulatedYamlChange", () => {
  // Pin the discriminator the section editor's debounce-skip
  // path uses. A regression that flips the polarity (or removes
  // the empty-state check) would silently re-introduce the 1s
  // empty-form window on page load.

  it("fires on first-time YAML arrival (undefined → real)", () => {
    expect(isEmptyToPopulatedYamlChange(undefined, "esphome:\n  name: x\n")).toBe(true);
  });

  it('fires on user-cleared-then-pasted ("" → real)', () => {
    expect(isEmptyToPopulatedYamlChange("", "esphome:\n  name: x\n")).toBe(true);
  });

  it("does not fire on typing (real → real)", () => {
    expect(
      isEmptyToPopulatedYamlChange("esphome:\n  name: x\n", "esphome:\n  name: xy\n")
    ).toBe(false);
  });

  it('does not fire on user-cleared-the-pane (real → "")', () => {
    expect(isEmptyToPopulatedYamlChange("esphome:\n  name: x\n", "")).toBe(false);
  });

  it('does not fire on noop-empty ("" → "")', () => {
    expect(isEmptyToPopulatedYamlChange("", "")).toBe(false);
  });

  it("tolerates a null prev (defensive — Lit's getter returns undefined, not null, but contract is documented as both)", () => {
    expect(isEmptyToPopulatedYamlChange(null, "esphome:\n")).toBe(true);
  });
});
