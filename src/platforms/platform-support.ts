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
 *  3. Export the ``PlatformSupport`` from ``dashboard.ts``, add it to
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

/** Replaces the logs dialog's RTS-pulse Reset Device for a session. */
export interface SerialResetHook {
  /** Whether the device behind this port can be reset this way. */
  supports(port: SerialPort): boolean;
  /** Gets the port closed and, like onReconnect, ends by attaching a fresh
   *  stream or ``setSerialOpenFailed``; ``cancelled`` flips once the dialog
   *  closed or the session moved on. */
  run(port: SerialPort, cancelled: () => boolean): Promise<void>;
}

/**
 * What a platform's logs code may do to a logs session. The logs code builds
 * it, so a platform never imports the logs dialog or its helpers.
 */
export interface LogsSessionContext {
  readonly localize: LocalizeFunc;
  /** Routes stream lines into the logs pane. */
  readonly lineHooks: SerialLineHooks;
  /** Ends the session with ``message`` in the pane (Start reconnects). */
  end(message: string): void;
  /** Ends the session and toasts ``message``, unless ``cancelled()``. */
  fail(message: string, cancelled?: () => boolean): void;
  setBleStream(cancel: () => Promise<void>): void;
}

export interface SerialLogsContext extends LogsSessionContext {
  readonly baudRate: number;
  /** Streams a port into the session, reopening it first when it is closed. */
  attach(port: SerialPort, cancelled: () => boolean): Promise<void>;
  /** Fails the session because ``port`` could not be reopened. */
  failReopen(port: SerialPort, cancelled: () => boolean): void;
}

/** Web Serial logs for the platform; its presence offers them in the logs picker. */
export interface SerialLogsPolicy {
  /** Reset Device pulses RTS; false where the port has no reset line. */
  readonly pulseResets: boolean;
  /** Drop DTR and RTS right after opening, so the board boots its firmware. */
  readonly releasesLinesAfterOpen: boolean;
  /** A Reset Device of the platform's own, or undefined where it can't run. */
  resetHook?(ctx: SerialLogsContext): SerialResetHook | undefined;
}

/** Logs over Web Bluetooth. */
export interface BleLogsSupport {
  /** The browser can do it; the platform already matched. */
  available(): boolean;
  pick(localize: LocalizeFunc, names: string[]): Promise<BluetoothDevice | null>;
  /** Streams ``device`` into the session, or fails it with the reason. */
  attach(
    ctx: LogsSessionContext,
    device: BluetoothDevice,
    cancelled: () => boolean
  ): Promise<void>;
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
