/**
 * The browser flashers' own steps, keyed by installer id. Each platform's
 * install module adds its entry with ``declare module`` (see
 * ``browser-flasher.ts``), so a new flasher needs no edit here.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface BrowserFlasherSteps {}

export type FlasherId = keyof BrowserFlasherSteps;
export type FlasherStep = BrowserFlasherSteps[FlasherId];

/** Steps every installer shares; the dialog renders these itself. */
export type SharedInstallStep =
  | "connecting"
  | "queued"
  | "installing"
  | "compiling"
  | "flashing"
  | "done"
  | "choose-binary"
  | "downloading"
  | "download-ready"
  | "error";

export type InstallStep = SharedInstallStep | FlasherStep;

// The ESP installers (web-serial, web-flash) are still built into the dialog;
// they move to a browser flasher descriptor in a later pass.
export type Installer = "web-serial" | "binary-download" | "web-flash" | FlasherId | null;

export type InstallFailureKind =
  "compile" | "validate" | "chip-mismatch" | "unsupported-browser" | null;
