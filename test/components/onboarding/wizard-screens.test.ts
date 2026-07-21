import { describe, expect, it } from "vitest";
import { wizardScreens } from "../../../src/components/onboarding/wizard-screens.js";

describe("wizardScreens", () => {
  it("is welcome, experience, tour with nothing detected", () => {
    expect(wizardScreens({ showExistingServer: false, showTour: true })).toEqual([
      "welcome",
      "experience",
      "tour",
    ]);
  });

  it("inserts the existing-server step after experience when detected", () => {
    expect(wizardScreens({ showExistingServer: true, showTour: true })).toEqual([
      "welcome",
      "experience",
      "existing_server",
      "tour",
    ]);
  });

  it("drops the tour offer on viewports that can't run the tour", () => {
    expect(wizardScreens({ showExistingServer: false, showTour: false })).toEqual([
      "welcome",
      "experience",
    ]);
    expect(wizardScreens({ showExistingServer: true, showTour: false })).toEqual([
      "welcome",
      "experience",
      "existing_server",
    ]);
  });

  it("never includes Wi-Fi setup", () => {
    expect(wizardScreens({ showExistingServer: true, showTour: true })).not.toContain(
      "wifi"
    );
    expect(wizardScreens({ showExistingServer: false, showTour: false })).not.toContain(
      "wifi"
    );
  });
});
