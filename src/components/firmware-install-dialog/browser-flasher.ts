/**
 * A browser flasher: one platform's compile-then-flash flow in the install
 * dialog (nRF52 DFU, Pico UF2, RTL8720C ROM downloader). Each platform's
 * ``dashboard.ts`` exports one descriptor, ``src/platforms/browser-flashers.ts``
 * lists them, and the dialog, the method rows and ``applyInstallMethod`` read
 * everything platform-specific from it.
 *
 * Adding a flasher:
 *  1. Augment ``BrowserFlasherSteps`` with the flasher's own steps:
 *     ``declare module ".../firmware-install-dialog/types.js" {
 *        interface BrowserFlasherSteps { "bk-uart": "bk-ready" | "bk-wait" } }``
 *  2. Keep the parsed image in a ``FlashImageSlot`` and export a
 *     ``BrowserFlasher<"bk-uart">`` from the platform's install module.
 *  3. Add it to ``BROWSER_FLASHERS``, and its copy to ``en.json``.
 */
import type { TemplateResult } from "lit";

import type { ESPHomeFirmwareInstallDialog } from "../firmware-install-dialog.js";
import type { BrowserFlasherSteps, FlasherId } from "./types.js";

type Host = ESPHomeFirmwareInstallDialog;

/** A footer button's work; runs from the click (a user gesture, for the pickers). */
export type FlasherAction = (host: Host) => void | Promise<void>;

export interface FlasherFooterAction {
  run: FlasherAction;
  labelKey: string;
}

/** The footer labels the bootloader steps share. */
export const FLASH_ACTION_KEY = "firmware.browser_flash_action";
export const RESET_ACTION_KEY = "firmware.browser_flash_reset_action";

export interface FlasherFooter {
  primary: FlasherFooterAction;
  secondary?: FlasherFooterAction;
}

/** How the dialog renders one of a flasher's steps. */
export interface FlasherStepView {
  /** Localize key for the card detail; a function when it depends on the browser. */
  detailKey: string | (() => string);
  /** The step's buttons; without one the step shows the running footer (Stop). */
  footer?: () => FlasherFooter;
  /** Body under the status text. */
  extra?: (host: Host) => TemplateResult;
}

export interface BrowserFlasher<Id extends FlasherId> {
  /** The installer id, which is also the install method string. */
  readonly id: Id;
  matches(platform: string | null | undefined): boolean;
  /** Method row copy: ``dashboard.install_method_<key>`` and its ``_desc``. */
  readonly methodKey: string;
  /** The flash leaves a port the logs can reopen (the show-logs toggle). */
  readonly holdsPort: boolean;
  /** Where the flasher keeps its parsed image; Retry skips the compile while it holds one. */
  readonly image: FlashImageSlot<object>;
  /** Compile, download and parse, then show the first user-gesture step. */
  start(host: Host): Promise<void>;
  /** The Retry target while the parsed image is kept. */
  showFirstStep(host: Host): void;
  readonly steps: { readonly [S in BrowserFlasherSteps[Id]]: FlasherStepView };
  /** Copy for a download-ready step the flasher reaches (the Pico UF2 fallback). */
  readonly downloadReady?: { titleKey: string; bodyKey: string };
}

export type AnyBrowserFlasher = { [Id in FlasherId]: BrowserFlasher<Id> }[FlasherId];

/** The active flasher's view of the current step, if the step is its own. */
export function flasherStepView(host: Host): FlasherStepView | undefined {
  const steps: Partial<Record<string, FlasherStepView>> | undefined =
    host._flasher?.steps;
  return steps?.[host._step];
}

/**
 * A typed view of the dialog's one ``_flashImage`` slot for one flasher. It
 * only hands back images it stored itself, so a flasher never reads another
 * one's image, and it stays null after the dialog resets the slot.
 */
export class FlashImageSlot<T extends object> {
  private readonly owned = new WeakSet<object>();

  private isMine(value: unknown): value is T {
    return typeof value === "object" && value !== null && this.owned.has(value);
  }

  set(host: Host, image: T): void {
    this.owned.add(image);
    host._flashImage = image;
  }

  get(host: Host): T | null {
    const value = host._flashImage;
    return this.isMine(value) ? value : null;
  }
}
