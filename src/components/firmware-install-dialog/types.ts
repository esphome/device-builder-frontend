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
  | "error";

export type Installer =
  "web-serial" | "binary-download" | "web-flash" | "nrf-dfu" | "rp2-uf2" | null;

export type InstallFailureKind =
  "compile" | "validate" | "chip-mismatch" | "unsupported-browser" | null;
