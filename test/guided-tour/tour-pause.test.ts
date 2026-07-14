/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../src/util/navigation.js", () => ({
  navigate: vi.fn(async (url: string) => {
    window.history.pushState(null, "", url);
  }),
}));

import { ESPHomeGuidedTour } from "../../src/components/guided-tour/esphome-guided-tour.js";
import { captureTourConfiguration } from "../../src/components/guided-tour/tour-route.js";
import {
  clearTourConfiguration,
  clearTourPending,
  getActiveTourConfiguration,
  getPendingTourStep,
  getTourConfiguration,
  isTourPending,
  setTourActive,
  setTourConfiguration,
  setTourPending,
} from "../../src/components/guided-tour/tour-session.js";
import { TOUR_STEPS } from "../../src/components/guided-tour/tour-steps.js";
import { navigate } from "../../src/util/navigation.js";

interface TourInternals {
  _active: boolean;
  _remoteComputeOnly: boolean;
  _showAnchorRecovery: boolean;
  _dialogReady: boolean;
  _stepIndex: number;
  _anchors: Map<string, Element>;
  _actionAnchorEls(): Element[];
  _bouncePopover(): void;
  _refresh(): void;
  _onDialogShown(): void;
  _maybeAutoAdvance(): boolean;
  _onKeydown(event: KeyboardEvent): void;
  _next(): void;
  _pause(): void;
  _finish(): void;
  firstUpdated(): void;
}

const internals = (tour: ESPHomeGuidedTour) => tour as unknown as TourInternals;

const sized = (el: HTMLElement): HTMLElement => {
  el.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 24,
      right: 120,
      width: 120,
      height: 24,
    }) as DOMRect;
  return el;
};

afterEach(() => {
  vi.useRealTimers();
  clearTourConfiguration();
  clearTourPending();
  setTourActive(false);
  window.history.replaceState(null, "", "/");
  vi.clearAllMocks();
});

describe("guided-tour pause state", () => {
  it("keeps the tour pending when closed for now", () => {
    const tour = new ESPHomeGuidedTour();
    const state = internals(tour);
    tour.start();
    setTourConfiguration("paused.yaml");

    state._pause();

    expect(state._active).toBe(false);
    expect(isTourPending()).toBe(true);
    expect(getPendingTourStep()).toBe(0);
    expect(getTourConfiguration()).toBe("paused.yaml");
    expect(getActiveTourConfiguration()).toBeNull();
  });

  it("clears pending state when the tour is skipped or finished", () => {
    const tour = new ESPHomeGuidedTour();
    const state = internals(tour);
    tour.start();

    state._finish();

    expect(isTourPending()).toBe(false);
  });

  it("can start again after a completed tour", () => {
    const tour = new ESPHomeGuidedTour();
    const state = internals(tour);
    tour.start();
    state._finish();

    tour.start();

    expect(state._active).toBe(true);
    expect(state._stepIndex).toBe(0);
    expect(getPendingTourStep()).toBe(0);
  });

  it("does not start in remote-compute-only mode", () => {
    setTourPending();
    const tour = new ESPHomeGuidedTour();
    const state = internals(tour);
    state._remoteComputeOnly = true;

    tour.start();

    expect(state._active).toBe(false);
    expect(isTourPending()).toBe(false);
  });

  it("reopens a pending tour on the next load", () => {
    setTourPending();
    const state = internals(new ESPHomeGuidedTour());

    state.firstUpdated();

    expect(state._active).toBe(true);
  });

  it("resumes the saved device step and route", async () => {
    const yamlIndex = TOUR_STEPS.findIndex((step) => step.anchors.includes("yaml"));
    setTourPending(yamlIndex);
    setTourConfiguration("my device.yaml");
    const state = internals(new ESPHomeGuidedTour());

    state.firstUpdated();
    await Promise.resolve();

    expect(state._stepIndex).toBe(yamlIndex);
    expect(navigate).toHaveBeenCalledWith("/device/my%20device.yaml");
  });

  it("restarts dialog-only action chains from the dashboard", async () => {
    const boardIndex = TOUR_STEPS.findIndex((step) =>
      step.anchors.includes("board-featured")
    );
    setTourPending(boardIndex);
    window.history.replaceState(null, "", "/secrets");
    const state = internals(new ESPHomeGuidedTour());

    state.firstUpdated();
    await Promise.resolve();

    expect(state._stepIndex).toBe(0);
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("pauses when a guarded route transition is cancelled", async () => {
    vi.mocked(navigate).mockImplementationOnce(async () => {});
    setTourPending();
    window.history.replaceState(null, "", "/secrets");
    const state = internals(new ESPHomeGuidedTour());

    state.firstUpdated();
    await Promise.resolve();

    expect(state._active).toBe(false);
    expect(isTourPending()).toBe(true);
  });

  it("pauses when guarded navigation rejects", async () => {
    const error = new Error("guard failed");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(navigate).mockRejectedValueOnce(error);
    setTourPending();
    window.history.replaceState(null, "", "/secrets");
    const state = internals(new ESPHomeGuidedTour());

    state.firstUpdated();
    await Promise.resolve();
    await Promise.resolve();

    expect(state._active).toBe(false);
    expect(isTourPending()).toBe(true);
    expect(warn).toHaveBeenCalledWith("Guided tour navigation failed:", error);
    warn.mockRestore();
  });

  it("remeasures a dialog anchor after its opening transition", () => {
    const state = internals(new ESPHomeGuidedTour());
    state._active = true;
    state._stepIndex = TOUR_STEPS.findIndex((step) =>
      step.anchors.includes("create-method-basic")
    );
    state._bouncePopover = vi.fn();
    state._refresh = vi.fn();

    state._onDialogShown();

    expect(state._bouncePopover).toHaveBeenCalledOnce();
    expect(state._refresh).toHaveBeenCalledOnce();
  });

  it("waits for the opening animation before showing the first dialog step", () => {
    const state = internals(new ESPHomeGuidedTour());
    state._active = true;
    state._stepIndex = 0;
    state._dialogReady = false;
    // The create button stays registered behind the modal.
    state._anchors.set("create-device-fab", document.createElement("button"));
    state._anchors.set("create-method-basic", sized(document.createElement("button")));

    expect(state._maybeAutoAdvance()).toBe(false);
    state._onDialogShown();
    expect(state._stepIndex).toBe(1);
  });

  it("does not advance into a wizard that is not visibly open", () => {
    const state = internals(new ESPHomeGuidedTour());
    state._active = true;
    state._stepIndex = 0;
    state._dialogReady = true;
    state._anchors.set("create-device-fab", document.createElement("button"));
    // A hidden dialog keeps its anchors registered but sizeless.
    state._anchors.set("create-method-basic", document.createElement("button"));

    expect(state._maybeAutoAdvance()).toBe(false);
    expect(state._stepIndex).toBe(0);
  });

  it("does not detach the click listener when a refresh leaves targets unchanged", () => {
    const state = internals(new ESPHomeGuidedTour());
    state._active = true;
    state._stepIndex = 0;
    const create = sized(document.createElement("button"));
    document.body.appendChild(create);
    state._anchors.set("create-device-fab", create);
    state._refresh();

    // Browsers skip a listener removed during dispatch even when re-added,
    // so the mid-click refresh caused by the wizard opening must not detach
    // _onAnchorClick while its click is still in flight.
    const removeSpy = vi.spyOn(create, "removeEventListener");
    state._refresh();
    expect(removeSpy).not.toHaveBeenCalled();

    create.click();
    create.remove();
    expect(state._stepIndex).toBe(1);
  });

  it("advances the navigator step only from ESPHome Core", () => {
    const state = internals(new ESPHomeGuidedTour());
    state._stepIndex = TOUR_STEPS.findIndex((step) => step.anchors.includes("nav"));
    const navigator = document.createElement("section");
    const core = document.createElement("button");
    state._anchors.set("nav", navigator);
    state._anchors.set("nav-core-item", core);

    expect(state._actionAnchorEls()).toEqual([core]);
  });

  it("advances from the semantic ESPHome Core selection event", () => {
    const tour = new ESPHomeGuidedTour();
    const state = internals(tour);
    const navigatorIndex = TOUR_STEPS.findIndex((step) => step.anchors.includes("nav"));
    tour.start(navigatorIndex);

    window.dispatchEvent(
      new CustomEvent("section-select", {
        detail: { sectionKey: "esphome" },
      })
    );

    expect(state._stepIndex).toBe(navigatorIndex + 1);
  });

  it("waits for successful creation before leaving the Wi-Fi step", () => {
    const state = internals(new ESPHomeGuidedTour());
    state._stepIndex = TOUR_STEPS.findIndex((step) =>
      step.anchors.includes("wifi-tour-continue")
    );
    state._anchors.set("wifi-tour-continue", document.createElement("button"));

    expect(state._actionAnchorEls()).toEqual([]);
  });

  it("remembers the created configuration for the dashboard spotlight", () => {
    const state = internals(new ESPHomeGuidedTour());
    state._active = true;
    window.history.replaceState(null, "", "/device/my%20tour.yaml");

    captureTourConfiguration(state._active);

    expect(getTourConfiguration()).toBe("my tour.yaml");
  });

  it("does not steal Enter from a focused tour button", () => {
    const state = internals(new ESPHomeGuidedTour());
    state._active = true;
    state._stepIndex = TOUR_STEPS.findIndex((step) => step.anchors.includes("central"));
    state._next = vi.fn();
    const event = {
      key: "Enter",
      composedPath: () => [document.createElement("button")],
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;

    state._onKeydown(event);

    expect(state._next).not.toHaveBeenCalled();
  });

  it("shows recovery controls when an anchor never appears", () => {
    vi.useFakeTimers();
    const state = internals(new ESPHomeGuidedTour());
    state._active = true;
    state._stepIndex = 0;

    state._refresh();
    vi.advanceTimersByTime(800);

    expect(state._showAnchorRecovery).toBe(true);
  });
});
