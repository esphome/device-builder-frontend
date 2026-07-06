import { describe, expect, it } from "vitest";
import { wizardScreens } from "../../../src/components/onboarding/wizard-screens.js";

describe("wizardScreens", () => {
  it("non-HA: use-case then experience", () => {
    expect(wizardScreens({ hasUseCase: true, collectWifi: false })).toEqual([
      "use_case",
      "experience",
    ]);
  });

  it("HA add-on: experience only (no use-case screen)", () => {
    expect(wizardScreens({ hasUseCase: false, collectWifi: false })).toEqual([
      "experience",
    ]);
  });

  it("beginner on a device-building install: appends the Wi-Fi screen", () => {
    expect(wizardScreens({ hasUseCase: false, collectWifi: true })).toEqual([
      "experience",
      "wifi",
    ]);
    expect(wizardScreens({ hasUseCase: true, collectWifi: true })).toEqual([
      "use_case",
      "experience",
      "wifi",
    ]);
  });
});
