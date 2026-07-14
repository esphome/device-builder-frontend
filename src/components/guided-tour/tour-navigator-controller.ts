import type { ReactiveController, ReactiveControllerHost } from "lit";

interface TourNavigatorOptions {
  isNavigatorStep: () => boolean;
  onCoreSelected: () => void;
  onReflow: () => void;
}

export class TourNavigatorController implements ReactiveController {
  private _active = false;

  constructor(
    host: ReactiveControllerHost,
    private readonly _options: TourNavigatorOptions
  ) {
    host.addController(this);
  }

  setActive(active: boolean): void {
    if (active === this._active) return;
    this._active = active;
    if (active) window.addEventListener("section-select", this._onSectionSelect);
    else window.removeEventListener("section-select", this._onSectionSelect);
  }

  anchorRegistered(id: string, element: Element): void {
    if (!this._active || id !== "nav-mobile-core") return;
    const root = element.getRootNode();
    const drawer = root instanceof ShadowRoot ? root.host.parentElement : null;
    drawer?.addEventListener("transitionend", this._options.onReflow, {
      once: true,
    });
  }

  hostDisconnected(): void {
    this.setActive(false);
  }

  private _onSectionSelect = (event: Event): void => {
    const { sectionKey } = (event as CustomEvent<{ sectionKey: string | null }>).detail;
    if (this._options.isNavigatorStep() && sectionKey === "esphome") {
      this._options.onCoreSelected();
    }
  };
}
