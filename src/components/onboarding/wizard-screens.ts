export type WizardScreen = "use_case" | "experience" | "wifi";

/**
 * The ordered onboarding-wizard screens for a given environment + choices.
 *
 * The use-case screen only appears on non-HA installs (`hasUseCase`); the
 * experience screen is always present. The Wi-Fi screen is appended only when
 * `collectWifi` — i.e. a beginner on a device-building install — so beginners
 * set shared credentials before the guided tour creates their first device,
 * while experts finish straight after the experience screen. Pure so the branch
 * logic is unit-testable without the component.
 */
export function wizardScreens(opts: {
  hasUseCase: boolean;
  collectWifi: boolean;
}): WizardScreen[] {
  const screens: WizardScreen[] = [];
  if (opts.hasUseCase) screens.push("use_case");
  screens.push("experience");
  if (opts.collectWifi) screens.push("wifi");
  return screens;
}
