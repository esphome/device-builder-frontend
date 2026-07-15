import type { ReactiveController, ReactiveControllerHost } from "lit";
import { isTourActive } from "../components/guided-tour/tour-session.js";
import {
  type DashboardStack,
  loadExpandedStack,
  saveExpandedStack,
} from "./dashboard-stacks-session.js";

interface DashboardStacksInputs {
  /** Remote-compute preference resolved (never flashes during prefs load). */
  remoteComputeReady(): boolean;
  /** A sender is approved to build here. */
  hasApprovedSender(): boolean;
  /** The raw hide_device_builder preference. */
  hideBuilder(): boolean;
}

/**
 * Owns the dashboard's Build server / Device builder accordion state.
 *
 * Exactly one stack is expanded at a time; the headers swap between
 * them, so neither can be closed. The session-scoped choice survives
 * navigation within a visit; the remote-compute preference picks the
 * default. Call `refreshTourState()` from the host's `willUpdate` —
 * one tour-session read per render cycle instead of one per getter.
 */
export class DashboardStacksController implements ReactiveController {
  // null = use the pref-driven default. Seeded once, saved on swap.
  private _choice = loadExpandedStack();

  private _tourEngaged = false;

  constructor(
    private readonly _host: ReactiveControllerHost,
    private readonly _inputs: DashboardStacksInputs
  ) {
    _host.addController(this);
  }

  hostConnected(): void {}

  /** The remote stack shows when opted in, or as soon as a sender is
   *  approved to build here. Otherwise the dashboard is untouched. */
  get show(): boolean {
    return this._inputs.remoteComputeReady() || this._inputs.hasApprovedSender();
  }

  /** The Device builder section is gone entirely (Build server only).
   *  Honoured only with the remote-compute pref on; a live tour
   *  overrides — its anchors must stay visible. */
  get builderHidden(): boolean {
    return (
      !this._tourEngaged &&
      this._inputs.hideBuilder() &&
      this._inputs.remoteComputeReady()
    );
  }

  get expanded(): DashboardStack {
    // A live tour anchors builder content; never hide it.
    if (this._tourEngaged) return "builder";
    if (this.builderHidden) return "remote";
    return this._choice ?? (this._inputs.remoteComputeReady() ? "remote" : "builder");
  }

  get remoteCollapsed(): boolean {
    return this.expanded !== "remote";
  }

  get builderCollapsed(): boolean {
    return this.expanded !== "builder";
  }

  /** Both headers share this: with two stacks and always-one-open, every
   *  header click means "show the other section". */
  swap = (): void => {
    const stack: DashboardStack = this.expanded === "remote" ? "builder" : "remote";
    this._choice = stack;
    saveExpandedStack(stack);
    this._host.requestUpdate();
  };

  /**
   * Re-read the tour flag; only a *live* spotlight forces the builder
   * section (the pending-resume key survives a click-outside pause and
   * must not hold the Build server bar dead).
   */
  refreshTourState(): void {
    this._tourEngaged = isTourActive();
  }
}
