import { describe, expect, it } from "vitest";
import { wizardScreens } from "../../../src/components/onboarding/wizard-screens.js";

describe("wizardScreens", () => {
  it("non-HA: welcome, use case, experience, then tour offer", () => {
    expect(wizardScreens({ hasUseCase: true })).toEqual([
      "welcome",
      "use_case",
      "experience",
      "tour",
    ]);
  });

  it("HA add-on: skips the use-case screen", () => {
    expect(wizardScreens({ hasUseCase: false })).toEqual([
      "welcome",
      "experience",
      "tour",
    ]);
  });

  it("never includes Wi-Fi setup", () => {
    expect(wizardScreens({ hasUseCase: true })).not.toContain("wifi");
    expect(wizardScreens({ hasUseCase: false })).not.toContain("wifi");
  });
});
