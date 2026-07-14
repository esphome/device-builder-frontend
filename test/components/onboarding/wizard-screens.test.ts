import { describe, expect, it } from "vitest";
import { wizardScreens } from "../../../src/components/onboarding/wizard-screens.js";

describe("wizardScreens", () => {
  it("asks non-HA expert users how they will use the dashboard", () => {
    expect(
      wizardScreens({ hasUseCase: true, isExpert: true, showExistingServer: false })
    ).toEqual(["welcome", "experience", "use_case", "tour"]);
  });

  it("skips the use-case screen for beginners", () => {
    expect(
      wizardScreens({ hasUseCase: true, isExpert: false, showExistingServer: false })
    ).toEqual(["welcome", "experience", "tour"]);
  });

  it("skips the use-case screen in the HA add-on", () => {
    expect(
      wizardScreens({ hasUseCase: false, isExpert: true, showExistingServer: false })
    ).toEqual(["welcome", "experience", "tour"]);
  });

  it("inserts the existing-server screen directly after welcome", () => {
    expect(
      wizardScreens({ hasUseCase: false, isExpert: false, showExistingServer: true })
    ).toEqual(["welcome", "existing_server", "experience", "tour"]);
  });

  it("keeps the existing-server screen alongside the use-case screen", () => {
    expect(
      wizardScreens({ hasUseCase: true, isExpert: true, showExistingServer: true })
    ).toEqual(["welcome", "existing_server", "experience", "use_case", "tour"]);
  });

  it("omits the existing-server screen when none was detected", () => {
    expect(
      wizardScreens({ hasUseCase: true, isExpert: true, showExistingServer: false })
    ).not.toContain("existing_server");
  });

  it("never includes Wi-Fi setup", () => {
    expect(
      wizardScreens({ hasUseCase: true, isExpert: true, showExistingServer: true })
    ).not.toContain("wifi");
    expect(
      wizardScreens({ hasUseCase: false, isExpert: false, showExistingServer: false })
    ).not.toContain("wifi");
  });
});
