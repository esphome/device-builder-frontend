import { describe, expect, it } from "vitest";
import { wizardScreens } from "../../../src/components/onboarding/wizard-screens.js";

describe("wizardScreens", () => {
  it("non-HA: use-case then experience (Wi-Fi is collected per-device)", () => {
    expect(wizardScreens({ hasUseCase: true })).toEqual(["use_case", "experience"]);
  });

  it("HA add-on: experience only (no use-case screen)", () => {
    expect(wizardScreens({ hasUseCase: false })).toEqual(["experience"]);
  });
});
