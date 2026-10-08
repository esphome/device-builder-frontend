import type { ReactiveControllerHost } from "lit";

import type { LocalizeFunc } from "../../common/localize.js";
import type {
  LibreTinyFlashHooks,
  LibreTinyFlashResult,
} from "../../platforms/libretiny-flash.js";
import { getErrorMessage } from "../../util/error-message.js";
import { linkedImage } from "../platforms/libretiny-image.js";
import {
  fetchEsphomeWebManifest,
  fetchPublishedUf2,
  type FirmwareManifest,
  publishedKeys,
} from "../util/esphome-web-firmware.js";

import type {
  LibreTinyChip,
  LibreTinyInstall,
  LibreTinyPrebuilt,
} from "./esphome-web-libretiny-install-dialog.js";
import type { FilePickerError } from "./file-picker.js";
import { parseFailureCopy, Preparation, type Prepared } from "./preparation.js";

/** What the setup step installs: the published firmware, or the user's own UF2. */
export type InstallMode = "prebuilt" | "file";

/** Installs what was set up on the picked port. */
export type SetupRun = (
  port: SerialPort,
  hooks: LibreTinyFlashHooks
) => Promise<LibreTinyFlashResult>;

/** The manifest, and those of the family's prebuilt families it lists. */
interface Published {
  manifest: FirmwareManifest;
  families: readonly string[];
}

/**
 * What the install dialog installs: the published firmware where the
 * manifest lists the family's, read when the dialog opens, or the UF2 the
 * user picks. An image known before the link is fetched or read, and
 * parsed, ahead of the click, so the click that installs it goes straight to
 * the port picker; one the chip picks is fetched once linked.
 */
export class LibreTinySetup {
  mode: InstallMode = "prebuilt";
  /** The published image picked, where the chip does not tell it. */
  family = "";
  file: File | null = null;
  /** Why the picked file or the published image cannot be installed. */
  error: FilePickerError | null = null;

  readonly image: Preparation<File | string, unknown, FilePickerError>;

  // A close, or a later open, supersedes the read; ``false`` is nothing published.
  private readonly _published: Preparation<LibreTinyPrebuilt<unknown>, Published, false>;

  constructor(
    private readonly _host: ReactiveControllerHost,
    private readonly _install: () => LibreTinyInstall<unknown>,
    private readonly _localize: () => LocalizeFunc,
    private readonly _fileInput: () => HTMLInputElement | undefined
  ) {
    this._published = new Preparation(
      _host,
      (prebuilt) => this._readManifest(prebuilt),
      (failure) => {
        if (failure === null) this._onPublished();
      },
      () => false
    );
    this.image = new Preparation(
      _host,
      (source) => this._parse(source),
      (failure) => this._onPrepared(failure),
      // A revoked file handle rejects the read.
      (err) => ({
        title: this._localize()(this._install().copy.badFile),
        detail: getErrorMessage(err),
      })
    );
  }

  /** The prebuilt families the manifest lists; none offers only the file. */
  get families(): readonly string[] {
    const state = this._published.state;
    return state.kind === "ready" ? state.value.families : [];
  }

  /** The published firmware is what gets installed. */
  get prebuilt(): boolean {
    return this.families.length > 0 && this.mode === "prebuilt";
  }

  /** The published image is told by the chip that answers: nothing to prepare. */
  get linked(): boolean {
    return !!this._linkedRun;
  }

  // Runs the image the linked chip picks, in the published firmware's mode of
  // a family whose chip tells it.
  private get _linkedRun(): SetupRun | undefined {
    const install = this._install();
    const prebuilt = this.prebuilt ? install.prebuilt : undefined;
    const published = this._published.state;
    if (!prebuilt?.runLinked || published.kind !== "ready") return undefined;
    const { manifest } = published.value;
    const { runLinked } = prebuilt;
    return (port, hooks) =>
      runLinked.call(
        prebuilt,
        port,
        (linked) => linkedImage(install.load, manifest, linked),
        hooks
      );
  }

  /** The parsed image's chip, for a family of several; else the family's own. */
  get active(): LibreTinyChip {
    const install = this._install();
    const prepared = this.image.state;
    return (prepared.kind === "ready" && install.forImage?.(prepared.value)) || install;
  }

  /** How to install what is set up, once it is ready. */
  get run(): SetupRun | undefined {
    const linked = this._linkedRun;
    if (linked) return linked;
    const install = this._install();
    const image = this.image.state;
    return image.kind === "ready"
      ? (port, hooks) => install.run(port, image.value, hooks)
      : undefined;
  }

  /** The dialog opened: read what the manifest publishes. */
  open(): void {
    const prebuilt = this._install().prebuilt;
    if (prebuilt) this._published.start(prebuilt);
  }

  /** The dialog closed. */
  reset(): void {
    this._published.clear();
    this.image.clear();
    this.error = null;
    this._unpick();
  }

  /** Install the published image of ``family``, or the user's own file. */
  setMode(mode: InstallMode, family = this.family): void {
    this.mode = mode;
    this.family = family;
    this.error = null;
    this._unpick();
    this.image.clear();
    if (mode === "file") return;
    // While the user clicks Install and picks the port.
    if (this.linked)
      void this._install()
        .loadEngine()
        .catch(() => {});
    else this.image.start(family);
  }

  onFileChange = (e: Event): void => {
    this.file = (e.target as HTMLInputElement).files?.[0] ?? null;
    this.error = null;
    if (this.file) this.image.start(this.file);
    else this.image.clear();
  };

  /** The parser or the published image did not load: load it again. */
  retry = (): void => {
    this.error = null;
    this.image.retry();
  };

  // Without the manifest, only the user's own file is offered.
  private async _readManifest(
    prebuilt: LibreTinyPrebuilt<unknown>
  ): Promise<Prepared<Published, false>> {
    try {
      const manifest = await fetchEsphomeWebManifest();
      const families = publishedKeys(manifest, prebuilt.families);
      if (families.length) return { value: { manifest, families } };
    } catch {
      // Offered as if nothing were published.
    }
    return { failure: false, retryable: false };
  }

  private _onPublished(): void {
    // A file picked while the manifest loaded is kept.
    if (this.file) {
      this.mode = "file";
      this._host.requestUpdate();
    } else {
      this.setMode("prebuilt", this.families[0]);
    }
  }

  private async _parse(
    source: File | string
  ): Promise<Prepared<unknown, FilePickerError>> {
    const install = this._install();
    const localize = this._localize();
    let bytes: Uint8Array;
    if (typeof source === "string") {
      const published = this._published.state;
      try {
        if (published.kind !== "ready") throw new Error("No manifest");
        bytes = await fetchPublishedUf2(published.value.manifest, source);
      } catch (err) {
        const title = localize("web.install.prebuilt_download_failed");
        return { failure: { title, detail: getErrorMessage(err) }, retryable: true };
      }
    } else {
      bytes = new Uint8Array(await source.arrayBuffer());
    }
    const parsed = await install.load(bytes);
    if ("image" in parsed) {
      // While the user clicks Install and picks the port; the flash names a failure.
      void (install.forImage?.(parsed.image) ?? install).loadEngine().catch(() => {});
      return { value: parsed.image };
    }
    const { key, retryable } = parseFailureCopy(parsed.key);
    return { failure: { title: localize(key), detail: parsed.detail }, retryable };
  }

  private _onPrepared(failure: FilePickerError | null): void {
    this.error = failure;
    if (this.image.state.kind === "idle") this._unpick();
  }

  // The input is emptied with the file: it fires no change for the file it
  // still holds, so that file could not be picked a second time.
  private _unpick(): void {
    this.file = null;
    const input = this._fileInput();
    if (input) input.value = "";
    this._host.requestUpdate();
  }
}
