export type WizardScreen =
  "welcome" | "existing_server" | "use_case" | "experience" | "tour";

/**
 * The ordered onboarding-wizard screens for the current environment.
 *
 * Welcome and experience are always mandatory. When another ESPHome server is
 * already on the network (non-add-on installs only), an orientation screen
 * follows Welcome. Expert users on non-HA installs also choose whether this
 * dashboard manages devices or acts as a remote build server. The optional-tour
 * offer always closes the flow. Wi-Fi is deliberately not part of onboarding.
 */
export function wizardScreens(opts: {
  hasUseCase: boolean;
  isExpert: boolean;
  showExistingServer: boolean;
}): WizardScreen[] {
  const screens: WizardScreen[] = ["welcome"];
  if (opts.showExistingServer) screens.push("existing_server");
  screens.push("experience");
  if (opts.hasUseCase && opts.isExpert) screens.push("use_case");
  screens.push("tour");
  return screens;
}
