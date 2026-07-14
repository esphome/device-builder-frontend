export type WizardScreen = "welcome" | "use_case" | "experience" | "tour";

/**
 * The ordered onboarding-wizard screens for the current environment.
 *
 * Welcome and experience are always mandatory. Expert users on non-HA installs
 * also choose whether this dashboard manages devices or acts as a remote build
 * server. The optional-tour offer always closes the flow. Wi-Fi is deliberately
 * not part of onboarding.
 */
export function wizardScreens(opts: {
  hasUseCase: boolean;
  isExpert: boolean;
}): WizardScreen[] {
  const screens: WizardScreen[] = ["welcome", "experience"];
  if (opts.hasUseCase && opts.isExpert) screens.push("use_case");
  screens.push("tour");
  return screens;
}
