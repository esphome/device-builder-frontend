import { describe, expect, it } from "vitest";
import { wizardScreens } from "../../../src/components/onboarding/wizard-screens.js";

describe("wizardScreens", () => {
  it("asks non-HA expert users how they will use the dashboard", () => {
    expect(wizardScreens({ hasUseCase: true, isExpert: true })).toEqual([
      "welcome",
      "experience",
      "use_case",
      "tour",
    ]);
  });

  it("skips the use-case screen for beginners", () => {
    expect(wizardScreens({ hasUseCase: true, isExpert: false })).toEqual([
      "welcome",
      "experience",
      "tour",
    ]);
  });

  it("skips the use-case screen in the HA add-on", () => {
    expect(wizardScreens({ hasUseCase: false, isExpert: true })).toEqual([
      "welcome",
      "experience",
      "tour",
    ]);
  });

  it("never includes Wi-Fi setup", () => {
    expect(wizardScreens({ hasUseCase: true, isExpert: true })).not.toContain("wifi");
    expect(wizardScreens({ hasUseCase: false, isExpert: false })).not.toContain("wifi");
  });
});
