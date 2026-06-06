import type { ReactiveController, ReactiveControllerHost } from "lit";
import { APIError, apiErrorDetails } from "../../api/api-error.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { arrayBufferToBase64 } from "../../util/base64.js";
import { safeUploadFilename } from "../../util/safe-upload-filename.js";
import { isBundleFilename } from "../../util/upload-file-types.js";

/** Wizard steps the import flow can route the host dialog to. */
export type ImportStep = "resolve-conflicts" | "confirm-overwrite" | "import-partial";

/** The slice of the create-config dialog the import flow drives. Keeps the
 *  controller decoupled from the dialog's private fields. */
export interface ImportFlowHost extends ReactiveControllerHost {
  readonly api: ESPHomeAPI;
  readonly localize: LocalizeFunc;
  /** Shared "a request is in flight" flag (the dialog's busy state). */
  importBusy: boolean;
  goToImportStep(step: ImportStep): void;
  navigateToCreated(configuration: string): void;
  setImportError(message: string): void;
  resetErrors(): void;
}

/**
 * Owns the "Import from file" flow (plain YAML upload + esphome bundle),
 * including the overwrite-confirm and conflict-resolution round-trips, so
 * the dialog stays a thin step machine. The host renders the import steps
 * from this controller's public state and forwards the step events here.
 */
export class ImportFlowController implements ReactiveController {
  /** Bundle files that already exist on disk (resolve-conflicts step). */
  conflicts: string[] = [];
  /** Whether the bundle ships secrets (merged, not a conflict). */
  hasSecrets = false;
  /** The bundle's main config filename (flagged in the conflict list). */
  mainConfig = "";
  /** Set after a partial import (some conflicts kept) for the result step. */
  partial: { configuration: string; kept: string[] } | null = null;

  private readonly _host: ImportFlowHost;
  private _file: File | null = null;
  /** Cached base64 so the conflict round-trip re-submits the same bytes. */
  private _bundleB64: string | null = null;
  private _pendingUpload: { slug: string; fileContent: string } | null = null;

  constructor(host: ImportFlowHost) {
    this._host = host;
    host.addController(this);
  }

  hostConnected(): void {
    // No teardown needed; state is reset by the host on open.
  }

  /** Device name shown by the overwrite-confirm step. */
  get pendingDeviceName(): string {
    return this._pendingUpload?.slug ?? "";
  }

  /** Clear all flow state (called when the dialog (re)opens). */
  reset(): void {
    this._file = null;
    this._bundleB64 = null;
    this.conflicts = [];
    this.hasSecrets = false;
    this.mainConfig = "";
    this.partial = null;
    this._pendingUpload = null;
  }

  /** Begin importing the picked file (YAML upload or bundle). */
  start(file: File): void {
    // Clear any prior pick's cached bytes / conflicts so a re-selection
    // can't re-submit the previous file or its stale state.
    this.reset();
    this._file = file;
    void this._createImportedDevice();
  }

  /** The user confirmed overwriting an existing device (upload path). */
  confirmOverwrite(): void {
    if (!this._pendingUpload) return;
    const { slug, fileContent } = this._pendingUpload;
    void this._runUpload(slug, fileContent, true);
  }

  /** The user picked which conflicting bundle files to overwrite. */
  resolveConflicts(overwrite: string[]): void {
    void this._importBundleFlow(overwrite);
  }

  private async _createImportedDevice(): Promise<void> {
    if (this._host.importBusy) return;
    if (!this._file) return;

    if (isBundleFilename(this._file.name)) {
      await this._importBundleFlow();
      return;
    }

    this._host.resetErrors();

    let fileContent: string;
    try {
      fileContent = await this._file.text();
    } catch {
      this._host.setImportError(this._host.localize("wizard.import_read_error"));
      return;
    }

    // Preserve the user's original filename character-for-character —
    // ``safeUploadFilename`` only strips characters that would break a
    // filesystem write, so underscores / accents / non-Latin round-trip.
    const name = this._file.name.replace(/\.(yaml|yml)$/i, "");
    const slug = safeUploadFilename(name);
    if (!slug) {
      this._host.setImportError(
        this._host.localize("wizard.import_invalid_filename", { name })
      );
      return;
    }

    await this._runUpload(slug, fileContent);
  }

  /** Send a YAML upload. A first-time collision (`already_exists`) routes to
   *  the confirm-overwrite step; the confirm re-enters with `overwrite=true`,
   *  which replaces the config and keeps its labels. */
  private async _runUpload(
    slug: string,
    fileContent: string,
    overwrite = false
  ): Promise<void> {
    if (this._host.importBusy) return;
    this._host.resetErrors();
    this._host.importBusy = true;
    try {
      const { configuration } = await this._host.api.createDevice({
        name: slug,
        config_type: "upload",
        file_content: fileContent,
        ...(overwrite ? { overwrite: true } : {}),
      });
      this._host.navigateToCreated(configuration);
    } catch (err) {
      if (!overwrite && err instanceof APIError && err.errorCode === "already_exists") {
        this._pendingUpload = { slug, fileContent };
        this._host.goToImportStep("confirm-overwrite");
        return;
      }
      this._host.setImportError(
        apiErrorDetails(err) || this._host.localize("wizard.import_general_error")
      );
    } finally {
      this._host.importBusy = false;
    }
  }

  /** Import an esphome bundle. The first call sends the bytes; a 'conflicts'
   *  response routes to the resolve step, whose confirm re-enters here with
   *  the chosen `overwrite` paths (the cached base64 is reused). */
  private async _importBundleFlow(overwrite?: string[]): Promise<void> {
    // Flip busy synchronously, before the first await (the file read), so a
    // fast double-click can't fire two parallel import_bundle commands.
    if (this._host.importBusy) return;
    if (!this._file) return;
    this._host.resetErrors();
    this._host.importBusy = true;

    try {
      if (this._bundleB64 === null) {
        try {
          this._bundleB64 = arrayBufferToBase64(await this._file.arrayBuffer());
        } catch {
          this._host.setImportError(this._host.localize("wizard.import_read_error"));
          return;
        }
      }

      const res = await this._host.api.importBundle({
        file_content_b64: this._bundleB64,
        ...(overwrite !== undefined ? { overwrite } : {}),
      });
      if (res.status === "conflicts") {
        this.conflicts = res.conflicts;
        this.hasSecrets = res.has_secrets;
        this.mainConfig = res.configuration;
        this._host.goToImportStep("resolve-conflicts");
        return;
      }
      // A partial import (some conflicts kept) is shown explicitly so the
      // user knows the device may still run its old config.
      if (res.kept.length) {
        this.partial = { configuration: res.configuration, kept: res.kept };
        this._host.goToImportStep("import-partial");
        return;
      }
      this._host.navigateToCreated(res.configuration);
    } catch (err) {
      this._host.setImportError(
        apiErrorDetails(err) || this._host.localize("wizard.import_general_error")
      );
    } finally {
      this._host.importBusy = false;
    }
  }
}
