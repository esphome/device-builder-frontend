import { describe, expect, it } from "vitest";
import { wizardScreens } from "../../../src/components/onboarding/wizard-screens.js";

const base = {
  showUsage: false,
  usage: null,
  showExistingServer: false,
  showTour: true,
} as const;

describe("wizardScreens", () => {
  it("is welcome, experience, tour with nothing detected", () => {
    expect(wizardScreens({ ...base })).toEqual(["welcome", "experience", "tour"]);
  });

  it("inserts the existing-server step after experience when detected", () => {
    expect(wizardScreens({ ...base, showExistingServer: true })).toEqual([
      "welcome",
      "experience",
      "existing_server",
      "tour",
    ]);
  });

  it("drops the tour offer on viewports that can't run the tour", () => {
    expect(wizardScreens({ ...base, showTour: false })).toEqual([
      "welcome",
      "experience",
    ]);
    expect(wizardScreens({ ...base, showExistingServer: true, showTour: false })).toEqual(
      ["welcome", "experience", "existing_server"]
    );
  });

  it("asks the usage question right after welcome on the desktop app", () => {
    expect(wizardScreens({ ...base, showUsage: true })).toEqual([
      "welcome",
      "usage",
      "experience",
      "tour",
    ]);
  });

  it("keeps the standalone flow while standalone is picked", () => {
    expect(wizardScreens({ ...base, showUsage: true, usage: "standalone" })).toEqual([
      "welcome",
      "usage",
      "experience",
      "tour",
    ]);
  });

  it("ends the flow at the usage screen for a remote builder", () => {
    expect(wizardScreens({ ...base, showUsage: true, usage: "remote_builder" })).toEqual([
      "welcome",
      "usage",
    ]);
  });

  it("never shows the orientation step alongside the usage question", () => {
    expect(
      wizardScreens({ ...base, showUsage: true, showExistingServer: true })
    ).not.toContain("existing_server");
  });

  it("never includes Wi-Fi setup", () => {
    expect(wizardScreens({ ...base, showExistingServer: true })).not.toContain("wifi");
    expect(wizardScreens({ ...base, showUsage: true })).not.toContain("wifi");
  });
});
