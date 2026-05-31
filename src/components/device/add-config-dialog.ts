import { html, LitElement } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import type { BoardCatalogEntry } from "../../api/types/boards.js";
import { CORE_CATEGORIES } from "../../api/types/components.js";

import "./add-component-dialog.js";
import type { ESPHomeAddComponentDialog } from "./add-component-dialog.js";

/**
 * Thin wrapper around `<esphome-add-component-dialog>` that locks the
 * embedded catalog to `category="core"` so the user gets the same
 * UI/flow used for adding regular components, just narrowed to core
 * configuration entries (api, wifi, logger, target platforms,
 * substitutions, …).
 *
 * Kept as its own custom element so the navigator / board-info host
 * can `@query("esphome-add-config-dialog")` and call `.open()`
 * without conflating the two entry points.
 */
@customElement("esphome-add-config-dialog")
export class ESPHomeAddConfigDialog extends LitElement {
  @property()
  boardName = "";

  @property()
  configuration = "";

  /** Device's target platform — forwarded so per-platform defaults resolve. */
  @property()
  platform = "";

  /** Board metadata. Forwarded to the form so the embedded shared
   *  config-entry-form can render the GPIO pin selector with proper
   *  filtering. */
  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  /** Current device YAML; forwarded so the catalog can hide
   *  single-instance components that are already configured (every
   *  core component is single-instance — no `esphome:` v2 alongside
   *  the first one). */
  @property()
  yaml = "";

  @query("esphome-add-component-dialog")
  private _inner!: ESPHomeAddComponentDialog;

  /** Open the inner add-component dialog, locked to core. */
  public open() {
    this._inner.open();
  }

  protected render() {
    // Inner dialog lives in our shadow root so the host's
    // `@query("esphome-add-component-dialog")` only matches the
    // sibling regular dialog (otherwise it would also pick up our
    // core-locked one and route the wrong open() call).
    return html`<esphome-add-component-dialog
      .lockedCategories=${CORE_CATEGORIES}
      .boardName=${this.boardName}
      .configuration=${this.configuration}
      .platform=${this.platform}
      .board=${this.board}
      .yaml=${this.yaml}
    ></esphome-add-component-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-add-config-dialog": ESPHomeAddConfigDialog;
  }
}
