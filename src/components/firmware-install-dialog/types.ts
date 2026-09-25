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

export type InstallFailureKind =
  "compile" | "validate" | "chip-mismatch" | "unsupported-browser" | null;
