export type WizardScreen = "use_case" | "experience";

/**
 * The ordered onboarding-wizard screens for a given environment.
 *
 * The use-case screen only appears on non-HA installs (`hasUseCase`); the
 * experience screen is always present. Wi-Fi is no longer an onboarding step —
 * it's collected per-device in the create wizard. Pure so the branch logic is
 * unit-testable without the component.
 */
export function wizardScreens(opts: { hasUseCase: boolean }): WizardScreen[] {
  const screens: WizardScreen[] = [];
  if (opts.hasUseCase) screens.push("use_case");
  screens.push("experience");
  return screens;
}
