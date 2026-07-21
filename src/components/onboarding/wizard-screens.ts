export type WizardScreen =
  "welcome" | "usage" | "experience" | "existing_server" | "tour";

/** The desktop app's answer to "How do you want to use this installation?".
 *  null until the user reaches the usage screen (or on non-desktop installs,
 *  where the question is never asked). */
export type UsageChoice = "standalone" | "remote_builder";

/**
 * The ordered onboarding-wizard screens for the current environment.
 *
 * Welcome and experience are always mandatory. On the desktop app a usage
 * question comes right after Welcome: picking "standalone" continues the
 * normal flow, while "remote builder" ends the wizard there — the app
 * switches to remote-build mode and its own pairing onboarding takes over,
 * so experience/tour would be dead weight. The usage screen also subsumes
 * the existing-server orientation step (its remote-only switch asks the
 * same question), so that step never shows alongside it.
 *
 * Off the desktop app the flow is unchanged: when another Device Builder is
 * on the network (non-add-on installs only), the orientation step follows
 * experience — it's the only place the remote-build-server choice is
 * offered, since there's nothing to build for otherwise. The optional-tour
 * offer closes the flow on viewports that can run the guided tour; on
 * phones it's dropped and completing the choices lands straight on the
 * dashboard. Wi-Fi is deliberately not part of onboarding.
 */
export function wizardScreens(opts: {
  showUsage: boolean;
  usage: UsageChoice | null;
  showExistingServer: boolean;
  showTour: boolean;
}): WizardScreen[] {
  const screens: WizardScreen[] = ["welcome"];
  if (opts.showUsage) {
    screens.push("usage");
    // The wizard ends at the usage screen for a remote builder; while the
    // choice is still standalone (the default) or unset, the tail shows the
    // standalone flow so the step dots reflect what's ahead.
    if (opts.usage === "remote_builder") return screens;
    screens.push("experience");
  } else {
    screens.push("experience");
    if (opts.showExistingServer) screens.push("existing_server");
  }
  if (opts.showTour) screens.push("tour");
  return screens;
}
