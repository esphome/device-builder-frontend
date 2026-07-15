import { describe, expect, it } from "vitest";
import { wizardScreens } from "../../../src/components/onboarding/wizard-screens.js";

describe("wizardScreens", () => {
  it("is welcome, experience, tour with nothing detected", () => {
    expect(wizardScreens({ showExistingServer: false })).toEqual([
      "welcome",
      "experience",
      "tour",
    ]);
  });

  it("inserts the existing-server step after experience when detected", () => {
    expect(wizardScreens({ showExistingServer: true })).toEqual([
      "welcome",
      "experience",
      "existing_server",
      "tour",
    ]);
  });

  it("never includes Wi-Fi setup", () => {
    expect(wizardScreens({ showExistingServer: true })).not.toContain("wifi");
    expect(wizardScreens({ showExistingServer: false })).not.toContain("wifi");
  });
});
