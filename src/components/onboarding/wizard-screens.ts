export type WizardScreen = "use_case" | "experience" | "wifi";

/**
 * The ordered onboarding-wizard screens for a given environment and choice.
 *
 * The use-case screen only appears on non-HA installs (`hasUseCase`), and the
 * Wi-Fi screen is dropped once the user picks remote-compute (`remoteCompute`),
 * since a remote build node never joins Wi-Fi. The experience screen is always
 * present. Pure so the branch logic is unit-testable without the component.
 */
export function wizardScreens(opts: {
  hasUseCase: boolean;
  remoteCompute: boolean;
}): WizardScreen[] {
  const screens: WizardScreen[] = [];
  if (opts.hasUseCase) screens.push("use_case");
  screens.push("experience");
  if (!opts.remoteCompute) screens.push("wifi");
  return screens;
}
