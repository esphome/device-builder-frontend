import type { FlasherId, FlasherStep } from "../../platforms/platform-support.js";

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
// they move to a platform descriptor in a later pass.
export type Installer = "web-serial" | "binary-download" | "web-flash" | FlasherId | null;

export type InstallFailureKind =
  "compile" | "validate" | "chip-mismatch" | "unsupported-browser" | null;
