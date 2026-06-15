import { describe, expect, it } from "vitest";
import { wizardScreens } from "../../../src/components/onboarding/wizard-screens.js";

describe("wizardScreens", () => {
  it("non-HA, building devices: use-case, experience, then wifi", () => {
    expect(wizardScreens({ hasUseCase: true, remoteCompute: false })).toEqual([
      "use_case",
      "experience",
      "wifi",
    ]);
  });

  it("non-HA, remote-compute: drops the wifi screen", () => {
    expect(wizardScreens({ hasUseCase: true, remoteCompute: true })).toEqual([
      "use_case",
      "experience",
    ]);
  });

  it("HA add-on: no use-case screen, experience then wifi", () => {
    expect(wizardScreens({ hasUseCase: false, remoteCompute: false })).toEqual([
      "experience",
      "wifi",
    ]);
  });

  it("HA add-on + remote-compute: experience only", () => {
    expect(wizardScreens({ hasUseCase: false, remoteCompute: true })).toEqual([
      "experience",
    ]);
  });
});
