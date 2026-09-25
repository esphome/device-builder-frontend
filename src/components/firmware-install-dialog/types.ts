export type InstallStep =
  | "connecting"
  | "queued"
  | "installing"
  | "compiling"
  | "flashing"
  | "done"
  | "choose-binary"
  | "downloading"
  | "download-ready"
  | "nrf-reset"
  | "nrf-wait"
  | "rp2-bootsel"
  | "rp2-wait"
  | "rtl-ready"
  | "rtl-connect"
  | "rtl-wait"
  | "error";

export type Installer =
  | "web-serial"
  | "binary-download"
  | "web-flash"
  | "nrf-dfu"
  | "rp2-uf2"
  | "rtl-ambz2"
  | null;

/** Installers whose flash leaves a port the logs can reopen (Show logs on Done, the after-install toggle). */
export const PORT_HOLDING_INSTALLERS: ReadonlySet<Installer> = new Set<Installer>([
  "web-serial",
  "rtl-ambz2",
]);

export type InstallFailureKind =
  "compile" | "validate" | "chip-mismatch" | "unsupported-browser" | null;
