/**
 * What the Device Builder knows about one platform beyond ESP (nRF52, Pico,
 * RTL8720C): its in-app compile-then-flash flow and its logs policy. Each
 * platform's ``dashboard.ts`` exports one ``PlatformSupport``,
 * ``registry.ts`` lists them, and the install dialog, the method rows,
 * ``applyInstallMethod`` and the logs code read everything platform-specific
 * from it. ESP is still built into those.
 *
 * Adding a platform:
 *  1. Augment ``BrowserFlasherSteps`` with the install flow's own steps:
 *     ``declare module "../platform-support.js" {
 *        interface BrowserFlasherSteps { "bk-uart": "bk-ready" | "bk-wait" } }``
 *  2. Keep the parsed image in a ``FlashImageSlot`` and export a
 *     ``BrowserInstall<"bk-uart">`` from the platform's install module.
 *  3. Describe its logs in ``logs`` (Web Serial and Bluetooth logs, the
 *     line release on open, its own Reset Device), if it has any.
 *  4. Export the ``PlatformSupport`` from ``dashboard.ts``, add it to
 *     ``PLATFORMS``, and its copy to ``en.json``.
 */
import type { TemplateResult } from "lit";

import type { LocalizeFunc } from "../common/localize.js";
import type { ESPHomeFirmwareInstallDialog } from "../components/firmware-install-dialog.js";
import type { SerialLineHooks } from "../util/serial-log-stream.js";

type Host = ESPHomeFirmwareInstallDialog;

/**
 * The install flows' own steps, keyed by installer id. Each platform's
 * install module adds its entry with ``declare module``, so a new platform
 * needs no edit here.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface BrowserFlasherSteps {}

export type FlasherId = keyof BrowserFlasherSteps;
export type FlasherStep = BrowserFlasherSteps[FlasherId];

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

/** How the install dialog renders one of a flow's steps. */
export interface FlasherStepView {
  /** Localize key for the card detail; a function when it depends on the browser. */
  detailKey: string | (() => string);
  /** The step's buttons; without one the step shows the running footer (Stop). */
  footer?: () => FlasherFooter;
  /** Body under the status text. */
  extra?: (host: Host) => TemplateResult;
}

/** A platform's compile-then-flash flow in the install dialog. */
export interface BrowserInstall<Id extends FlasherId> {
  /** The installer id, which is also the install method string. */
  readonly id: Id;
  /** Method row copy: ``dashboard.install_method_<key>`` and its ``_desc``. */
  readonly methodKey: string;
  /** The flash leaves a port the logs can reopen (the show-logs toggle). */
  readonly holdsPort: boolean;
  /** Where the flow keeps its parsed image; Retry skips the compile while it holds one. */
  readonly image: FlashImageSlot<object>;
  /** Compile, download and parse, then show the first user-gesture step. */
  start(host: Host): Promise<void>;
  /** The Retry target while the parsed image is kept. */
  showFirstStep(host: Host): void;
  readonly steps: { readonly [S in BrowserFlasherSteps[Id]]: FlasherStepView };
  /** Copy for a download-ready step the flow reaches (the Pico UF2 fallback). */
  readonly downloadReady?: { titleKey: string; bodyKey: string };
}

export type AnyBrowserInstall = { [Id in FlasherId]: BrowserInstall<Id> }[FlasherId];

/** A platform's own Reset Device for a Web Serial logs session. */
export interface SerialResetSupport {
  /** The browser can send it (the button stays hidden otherwise). */
  available(): boolean;
  /** Whether the device behind this port can be reset this way. */
  supports(port: SerialPort): boolean;
  /** Resets the device and returns its port reopened, or null when it never came back. */
  reset(
    port: SerialPort,
    baudRate: number,
    cancelled: () => boolean
  ): Promise<SerialPort | null>;
  /** Localize key for a failed reset. */
  failureKey(err: unknown): string;
}

/** Web Serial logs for the platform; its presence offers them in the logs picker. */
export interface SerialLogsPolicy {
  /** Reset Device pulses RTS; false where the port has no reset line. */
  readonly pulseResets: boolean;
  /** Drop DTR and RTS right after opening, so the board boots its firmware. */
  readonly releasesLinesAfterOpen: boolean;
  /** Replaces the RTS pulse with the platform's own reset. */
  readonly reset?: SerialResetSupport;
}

/** Logs over Web Bluetooth. */
export interface BleLogsSupport {
  /** The browser can do it; the platform already matched. */
  available(): boolean;
  pick(localize: LocalizeFunc, names: string[]): Promise<BluetoothDevice | null>;
  /** Streams ``device``'s logs into ``hooks``; resolves to the stream's cancel. */
  connect(
    device: BluetoothDevice,
    hooks: SerialLineHooks,
    cancelled: () => boolean
  ): Promise<() => Promise<void>>;
  /** Localize key for a failed connect. */
  failureKey(err: unknown): string;
}

export interface PlatformLogs {
  readonly serial?: SerialLogsPolicy;
  readonly ble?: BleLogsSupport;
}

export interface PlatformSupport {
  /** The platform key, e.g. ``rp2``. */
  readonly id: string;
  matches(targetPlatform: string | null | undefined): boolean;
  readonly install?: AnyBrowserInstall;
  readonly logs?: PlatformLogs;
}

/**
 * A typed view of the install dialog's one ``_flashImage`` slot for one
 * flow. It only hands back images it stored itself, so a flow never reads
 * another one's image, and it stays null after the dialog resets the slot.
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
