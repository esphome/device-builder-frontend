export type WizardScreen = "welcome" | "use_case" | "experience" | "tour";

/**
 * The ordered onboarding-wizard screens for the current environment.
 *
 * Welcome and experience are always mandatory. The use-case screen only
 * appears on non-HA installs, and the optional-tour offer always closes the
 * flow. Wi-Fi is deliberately not part of onboarding.
 */
export function wizardScreens(opts: { hasUseCase: boolean }): WizardScreen[] {
  const screens: WizardScreen[] = ["welcome"];
  if (opts.hasUseCase) screens.push("use_case");
  screens.push("experience", "tour");
  return screens;
}
