import { consume } from "@lit/context";
import { mdiArrowLeft, mdiClose, mdiPackageVariantClosed } from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import {
  type BoardCatalogEntry,
  type ComponentCatalogEntry,
  type FeaturedBundle,
} from "../../api/types.js";
import type { ESPHomeAPI } from "../../api/index.js";
import { findAddedSection } from "../../util/yaml-sections.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext, apiContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { chooseExcludeCategories } from "./add-component-dialog-categories.js";
import {
  matchesDepDomain,
  navigateToDep,
  type DepNavHost,
} from "./add-component-dialog-dep-nav.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "./component-catalog.js";
import "./add-component-form.js";
import type { ESPHomeComponentCatalog } from "./component-catalog.js";

registerMdiIcons({
  close: mdiClose,
  "arrow-left": mdiArrowLeft,
  "package-variant-closed": mdiPackageVariantClosed,
});

@customElement("esphome-add-component-dialog")
export class ESPHomeAddComponentDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @property()
  boardName = "";

  @property()
  configuration = "";

  /** Device's target platform — forwarded to the catalog for default resolution. */
  @property()
  platform = "";

  /** Board metadata. Forwarded to the form so the embedded shared
   * config-entry-form can render the GPIO pin selector with proper
   * filtering and conflict detection. */
  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  /** Current device YAML. Forwarded to the form so it can resolve
   * `depends_on_component` predicates, the component-level
   * `dependencies` list, and ID-reference dropdowns. */
  @property()
  yaml = "";

  /** When non-empty, the dialog locks the catalog to those
   *  categories, hides the category sidebar, and switches its title
   *  to the core-config localization keys. The "Add core
   *  configuration" entry point sets `lockedCategories=CORE_CATEGORIES`
   *  so the same dialog handles both the regular and core flows.
   *
   *  When empty, the dialog tells the catalog to *exclude*
   *  `CORE_CATEGORIES` — those components belong to the dedicated
   *  core dialog, not the regular component selector. */
  @property({ attribute: false })
  lockedCategories: string[] = [];

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  @query("esphome-component-catalog")
  private _catalog!: ESPHomeComponentCatalog;

  @state()
  private _selected: ComponentCatalogEntry | null = null;

  @state()
  private _submitting = false;

  @state()
  private _submitError = "";

  /**
   * Component the user was originally adding when they clicked
   * "+ Add <dep>" inside the form. After they finish adding the
   * dependency, we restore this component so they don't have to
   * re-navigate the catalog and re-fill what they had.
   */
  @state()
  private _returnTo: ComponentCatalogEntry | null = null;

  /** Domain the dep detour was started for (e.g. "output"). Used to
   * locate the matching `references_component` field on the original
   * form so we can pre-fill it with the just-created component's id. */
  @state()
  private _depDomain: string | null = null;

  /** Pre-fill payload handed to the restored form on its next mount.
   *  Cleared after the form mounts so it doesn't apply to subsequent
   *  selections. */
  @state()
  private _prefillReference: { domain: string; id: string } | null = null;

  /**
   * Featured-component ids waiting to be added as part of the current
   * bundle, excluding the one currently in `_selected`. Each id is
   * already in the full `featured.<board>.<local>` shape so we can
   * fetch + send it without re-derivation. Empty when no bundle is in
   * flight.
   */
  @state()
  private _bundleQueue: string[] = [];

  /**
   * Progress shown in the form view while a bundle is being added.
   * `current` is the 1-based index of the component currently shown
   * in the form; `total` is the bundle's full length. Null when no
   * bundle is in flight.
   */
  @state()
  private _bundleProgress: {
    current: number;
    total: number;
    bundleName: string;
  } | null = null;

  static styles = [
    espHomeStyles,
    css`
      wa-dialog {
        --width: 900px;
      }

      wa-dialog.form-view {
        --width: 480px;
      }

      wa-dialog::part(header) {
        background: var(--esphome-primary);
        /* Right padding is 0 so the close button sits flush with the
           dialog's corner — the button is explicitly sized to a 40x40
           square below to give the X a comfortable hit target right
           where the user reaches for it. */
        padding: 0 0 0 var(--wa-space-m);
        height: 40px;
        box-sizing: border-box;
      }

      wa-dialog::part(title) {
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      wa-dialog::part(close-button__base) {
        background: transparent;
        border: none;
        box-shadow: none;
        /* Square 40x40 button matching the header height so the X has a
           comfortable click/tap target instead of just the icon's
           ~14px footprint. */
        padding: 0;
        width: 40px;
        height: 40px;
        min-width: unset;
        min-height: unset;
        color: var(--esphome-on-primary);
        cursor: pointer;
      }

      wa-dialog::part(body) {
        padding: var(--wa-space-l);
      }

      wa-dialog::part(footer) {
        display: none;
      }

      .dialog-label {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      .back-button {
        display: inline-flex;
        align-items: center;
        border: none;
        background: none;
        padding: 2px;
        margin-right: var(--wa-space-2xs);
        color: var(--esphome-on-primary);
        cursor: pointer;
        border-radius: 4px;
        opacity: 0.85;
      }

      .back-button:hover {
        opacity: 1;
      }

      /* Breadcrumb that shows up while the user is detoured into
         "add a dependency" mid-way through adding another component.
         Tells them we'll bring them back to the original after. */
      .return-banner {
        display: flex;
        align-items: center;
        gap: var(--wa-space-2xs);
        margin-bottom: var(--wa-space-m);
        padding: var(--wa-space-2xs) var(--wa-space-s);
        background: color-mix(
          in srgb,
          var(--esphome-primary),
          transparent 92%
        );
        border-left: 3px solid var(--esphome-primary);
        border-radius: var(--wa-border-radius-s);
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
      }

      .return-banner strong {
        color: var(--wa-color-text-normal);
        font-weight: var(--wa-font-weight-semibold);
      }

      .bundle-banner {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
        margin-bottom: var(--wa-space-m);
        padding: var(--wa-space-xs) var(--wa-space-s);
        background: color-mix(
          in srgb,
          var(--esphome-primary),
          transparent 92%
        );
        border-left: 3px solid var(--esphome-primary);
        border-radius: var(--wa-border-radius-s);
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-normal);
      }

      .bundle-banner wa-icon {
        font-size: 14px;
        color: var(--esphome-primary);
      }
    `,
  ];

  public open() {
    this._resetDetourState();
    this._selected = null;
    this._submitError = "";
    this._submitting = false;
    this._dialog.open = true;
    this.updateComplete.then(() => this._catalog?.load());
  }

  /**
   * Open the dialog directly into the catalog filtered to a domain
   * (e.g. "output"). Used when the section editor's ID-reference
   * dropdown asks "+ Add new output" — we land the user one click
   * away from the right component instead of in the unfiltered
   * catalog.
   */
  public openWithSearch(domain: string) {
    this._resetDetourState();
    this._selected = null;
    this._submitError = "";
    this._submitting = false;
    this._dialog.open = true;
    this.updateComplete.then(() => this._catalog?.filterByDomain(domain));
  }

  /** See ``navigateToDep`` for the seq-counter contract. */
  private _depNavSeq = 0;

  private _resetDetourState() {
    this._returnTo = null;
    this._depDomain = null;
    this._prefillReference = null;
    this._bundleQueue = [];
    this._bundleProgress = null;
    this._depNavSeq++;
  }

  protected render() {
    const isForm = this._selected !== null;
    // The same dialog drives both the regular catalog flow and the
    // "Add core configuration" flow — a non-empty
    // `lockedCategories` flips the title text and tells the catalog
    // to lock its filter to that set.
    const isCore = this.lockedCategories.length > 0;
    const headerKey = isCore
      ? this.boardName
        ? "device.add_config_dialog_title"
        : "device.add_config"
      : this.boardName
        ? "device.add_component_dialog_title"
        : "device.add_component";
    // Keep the catalog mounted permanently so its state (search query, scroll
    // position, expanded card) survives the round trip into the form view —
    // hide it with `hidden` rather than swapping it out of the DOM. The form
    // is fine to mount/unmount on demand since each selection starts fresh.
    return html`
      <wa-dialog
        class=${isForm ? "form-view" : ""}
        light-dismiss
        @add-component=${this._onComponentSelected}
        @add-bundle=${this._onBundleSelected}
        @form-cancel=${this._onBack}
        @form-submit=${this._onFormSubmit}
        @navigate-to-dep=${this._onNavigateToDep}
        @request-add-component=${this._onNavigateToDep}
      >
        <span slot="label" class="dialog-label">
          ${isForm
            ? html`<button class="back-button" @click=${this._onBack}>
                <wa-icon library="mdi" name="arrow-left"></wa-icon>
              </button>`
            : nothing}
          ${isForm
            ? this._selected!.name
            : this.boardName
              ? this._localize(headerKey, { name: this.boardName })
              : this._localize(headerKey)}
        </span>
        ${this._returnTo
          ? html`<div class="return-banner">
              ${this._localize("device.return_to_after_dep_prefix")}
              <strong>${this._returnTo.name}</strong>
              ${this._localize("device.return_to_after_dep_suffix")}
            </div>`
          : nothing}
        ${isForm && this._bundleProgress
          ? html`<div class="bundle-banner">
              <wa-icon library="mdi" name="package-variant-closed"></wa-icon>
              <span
                >${this._localize("device.bundle_step_progress", {
                  current: this._bundleProgress.current,
                  total: this._bundleProgress.total,
                  name: this._bundleProgress.bundleName,
                })}</span
              >
            </div>`
          : nothing}
        <esphome-component-catalog
          ?hidden=${isForm}
          .platform=${this.platform}
          .boardId=${this.board?.id ?? ""}
          .board=${this.board}
          .yaml=${this.yaml}
          .lockedCategories=${this.lockedCategories}
          .excludeCategories=${chooseExcludeCategories({
            isCoreLocked: isCore,
            isInDepDetour: this._returnTo !== null,
          })}
        ></esphome-component-catalog>
        ${isForm
          ? html`<esphome-add-component-form
              .component=${this._selected!}
              .board=${this.board}
              .yaml=${this.yaml}
              .prefillReference=${this._prefillReference}
              .submitting=${this._submitting}
              .submitError=${this._submitError}
            ></esphome-add-component-form>`
          : nothing}
      </wa-dialog>
    `;
  }

  private _onComponentSelected(e: CustomEvent<{ component: ComponentCatalogEntry }>) {
    e.stopPropagation();
    this._selected = e.detail.component;
    this._submitError = "";
  }

  /**
   * Picking a bundle queues the bundle's components and opens the
   * form view on the first one. Each successful submit advances the
   * queue (`_onFormSubmit`); cancelling clears state but keeps any
   * already-added components in the YAML — no rollback, consistent
   * with the regular flow.
   */
  private async _onBundleSelected(
    e: CustomEvent<{ bundle: FeaturedBundle; boardId: string }>,
  ) {
    e.stopPropagation();
    if (this._submitting) return;
    const { bundle, boardId } = e.detail;
    if (!boardId || bundle.component_ids.length === 0) return;
    const fullIds = bundle.component_ids.map(
      (localId) => `featured.${boardId}.${localId}`,
    );
    const [first, ...rest] = fullIds;
    // The WS layer can throw on a transient disconnect / timeout; an
    // unhandled rejection here would leave the dialog half-transitioned
    // (still on the catalog view but with bundle state about to be set
    // by the rest of this handler). Catch and surface via the same
    // banner the form submit uses, then bail.
    let component: Awaited<ReturnType<ESPHomeAPI["getComponent"]>>;
    try {
      component = await this._api.getComponent(
        first,
        this.platform || undefined,
        boardId,
      );
    } catch (err) {
      this._submitError =
        err instanceof Error
          ? err.message
          : this._localize("device.add_component_error");
      return;
    }
    if (!component) {
      this._submitError = this._localize("device.add_component_error");
      return;
    }
    // Picking a bundle is a fresh sequence — abandon any in-flight
    // dep-detour state from the previous component the user was filling.
    // Without this clear, the bundle's first submit would route through
    // the `_returnTo` branch in `_onFormSubmit`, restoring the unrelated
    // component while the bundle queue + banner stayed live, and the
    // next submit would jump into bundle step 2 from there.
    this._returnTo = null;
    this._depDomain = null;
    this._prefillReference = null;
    this._bundleQueue = rest;
    this._bundleProgress = {
      current: 1,
      total: fullIds.length,
      bundleName: bundle.name,
    };
    this._selected = component;
    this._submitError = "";
  }

  private _onBack() {
    if (this._submitting) return;
    // If the user is in the middle of a "go add a dependency" detour
    // and they hit back, treat it as cancelling the detour: drop them
    // back at the original component they were filling in, instead of
    // sending them to the catalog and losing context.
    if (this._returnTo) {
      const restore = this._returnTo;
      this._resetDetourState();
      this._selected = restore;
      this._submitError = "";
      return;
    }
    // Returning to the catalog (mid-bundle cancel or otherwise) —
    // drop all detour state so a leftover `_prefillReference` from an
    // abandoned bundle step can't leak into the next component the
    // user selects. Already-added bundle components stay in the YAML;
    // we don't roll them back (consistent with the regular flow's
    // no-rollback behaviour on errors).
    this._resetDetourState();
    this._selected = null;
    this._submitError = "";
  }

  private _onNavigateToDep(e: CustomEvent<{ domain: string }>) {
    e.stopPropagation();
    return navigateToDep(this as unknown as DepNavHost, e.detail.domain);
  }

  private async _onFormSubmit(e: CustomEvent<{ fields: Record<string, unknown> }>) {
    e.stopPropagation();
    if (!this._selected || !this.configuration || this._submitting) return;
    this._submitting = true;
    this._submitError = "";
    // Invalidate any in-flight dep-nav lookup — a late resolve must
    // not retarget the form to a dep after the user submitted.
    this._depNavSeq++;
    try {
      const { yaml } = await this._api.addComponent(this.configuration, {
        component_id: this._selected.id,
        fields: e.detail.fields,
      });

      // Notify the host so the page re-fetches / re-renders with the
      // new YAML. We dispatch this BEFORE deciding whether to close —
      // when restoring `_returnTo` the dialog stays open, but we still
      // need the device to know the YAML changed (so the dependency
      // we just added shows up in the original component's dropdown).
      this.dispatchEvent(
        new CustomEvent("yaml-updated", {
          detail: { yaml },
          bubbles: true,
          composed: true,
        }),
      );

      if (this._returnTo) {
        // Just finished adding a dependency — restore the original
        // component's form so the user can continue where they left
        // off. The form re-mounts fresh and re-reads `this.yaml`,
        // which now contains the dep, so the ID-reference dropdown
        // will be populated.
        //
        // This branch wins over the bundle-advance branch below: if
        // the user is mid-bundle and detours to add a missing dep,
        // submitting the dep should return them to the bundle step
        // they were on, not skip ahead to the next bundle component.
        // The bundle queue stays intact so the bundle step's own
        // submit (the next time around) will fall through to the
        // bundle-advance branch and continue.
        const restore = this._returnTo;
        const depDomain = this._depDomain;
        // Pre-fill the restored form's reference field with the new
        // id when the just-added component matches what the dep-nav
        // asked for (defends against the user picking off-domain in
        // the catalog fallback).
        const newId = e.detail.fields["id"];
        if (
          depDomain &&
          typeof newId === "string" &&
          matchesDepDomain(this._selected, depDomain)
        ) {
          this._prefillReference = { domain: depDomain, id: newId };
        } else {
          this._prefillReference = null;
        }
        this._returnTo = null;
        this._depDomain = null;
        this._selected = restore;
      } else if (this._bundleQueue.length > 0 && this._bundleProgress) {
        // Bundle in flight — pop the next featured id and refresh the
        // form for it. The just-updated `this.yaml` (carried in via
        // the `yaml-updated` event) is still authoritative for the
        // next step's ID-reference dropdown, since the host re-binds
        // it on re-render.
        const nextId = this._bundleQueue[0];
        const remaining = this._bundleQueue.slice(1);
        const nextComponent = await this._api.getComponent(
          nextId,
          this.platform || undefined,
          this.board?.id ?? undefined,
        );
        if (!nextComponent) {
          this._submitError = this._localize("device.add_component_error");
          return;
        }
        // Hand the just-added component's id to the next step's matching
        // `references_component` field. Bundles are designed to chain —
        // e.g. `Status LED (full setup)` adds an `output.gpio`, then a
        // `light.binary` whose `output:` field has to point at it — and
        // without this prefill the user has to re-pick the id they just
        // typed in the previous step from a dropdown.
        const justAddedId = e.detail.fields["id"];
        const justAddedDomain = this._selected.category;
        if (typeof justAddedId === "string" && justAddedDomain) {
          this._prefillReference = {
            domain: justAddedDomain,
            id: justAddedId,
          };
        } else {
          this._prefillReference = null;
        }
        this._bundleQueue = remaining;
        this._bundleProgress = {
          ...this._bundleProgress,
          current: this._bundleProgress.current + 1,
        };
        this._selected = nextComponent;
      } else {
        // Auto-select the just-added component so the navigator
        // highlights it and the section editor jumps to its block.
        // Falls through silently if we can't find it — better to
        // leave the previous selection alone than navigate somewhere
        // wrong.
        const componentId = this._selected.id;
        const newId = e.detail.fields["id"];
        const target = findAddedSection(
          yaml,
          componentId,
          typeof newId === "string" ? newId : undefined,
        );
        if (target) {
          this.dispatchEvent(
            new CustomEvent("section-select", {
              detail: target,
              bubbles: true,
              composed: true,
            }),
          );
        }
        this._dialog.open = false;
        this._selected = null;
        this._resetDetourState();
      }
    } catch (err) {
      this._submitError = err instanceof Error
        ? err.message
        : this._localize("device.add_component_error");
    } finally {
      this._submitting = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-add-component-dialog": ESPHomeAddComponentDialog;
  }
}
