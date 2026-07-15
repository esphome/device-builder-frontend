export type WizardScreen = "welcome" | "experience" | "existing_server" | "tour";

/**
 * The ordered onboarding-wizard screens for the current environment.
 *
 * Welcome and experience are always mandatory. When another Device Builder is
 * on the network (non-add-on installs only), an orientation step follows
 * experience — it's the only place the remote-build-server choice is offered,
 * since there's nothing to build for otherwise. The optional-tour offer always
 * closes the flow. Wi-Fi is deliberately not part of onboarding.
 */
export function wizardScreens(opts: { showExistingServer: boolean }): WizardScreen[] {
  const screens: WizardScreen[] = ["welcome", "experience"];
  if (opts.showExistingServer) screens.push("existing_server");
  screens.push("tour");
  return screens;
}
