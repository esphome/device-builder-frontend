import type { ReactiveController, ReactiveControllerHost } from "lit";
import { isVisible } from "./is-visible.js";
import { ACCEPTED_UPLOAD_EXTENSIONS } from "./upload-file-types.js";

export interface FileDropControllerOptions {
  /** Drop target. Defaults to the host element. Injectable for tests. */
  target?: HTMLElement;
  /** Accepted filename extensions (lowercase). Defaults to the
   *  wizard upload set (.yaml/.yml + bundle archives). */
  extensions?: readonly string[];
}

/**
 * Reactive controller that turns the host element into a file drop
 * zone. While a file drag hovers the target, ``dragging`` is true so
 * the host can render a highlight; a drop hands the first file with
 * an accepted extension to ``onFile``.
 *
 * Also guards ``window`` while the target is visible: a file drop
 * that misses the target is swallowed instead of letting the browser
 * navigate to the file (Firefox would replace the SPA, losing all
 * state). Non-file drags (e.g. text into an editor) pass through
 * untouched, and a hidden-but-connected host (the create dialog stays
 * mounted while closed) doesn't suppress browser behavior elsewhere.
 */
export class FileDropController implements ReactiveController {
  dragging = false;

  private readonly _target: HTMLElement;
  private readonly _extensions: readonly string[];
  /** dragenter/dragleave fire per child node; a bare boolean flickers. */
  private _depth = 0;

  constructor(
    private readonly _host: ReactiveControllerHost & HTMLElement,
    private readonly _onFile: (file: File) => void,
    options: FileDropControllerOptions = {}
  ) {
    this._target = options.target ?? _host;
    this._extensions = options.extensions ?? ACCEPTED_UPLOAD_EXTENSIONS;
    _host.addController(this);
  }

  hostConnected() {
    this._target.addEventListener("dragenter", this._onDragEnter);
    this._target.addEventListener("dragover", this._onDragOver);
    this._target.addEventListener("dragleave", this._onDragLeave);
    this._target.addEventListener("drop", this._onDrop);
    window.addEventListener("dragover", this._onWindowDragOver);
    window.addEventListener("drop", this._onWindowDrop);
  }

  hostDisconnected() {
    this._target.removeEventListener("dragenter", this._onDragEnter);
    this._target.removeEventListener("dragover", this._onDragOver);
    this._target.removeEventListener("dragleave", this._onDragLeave);
    this._target.removeEventListener("drop", this._onDrop);
    window.removeEventListener("dragover", this._onWindowDragOver);
    window.removeEventListener("drop", this._onWindowDrop);
    this._setDragging(false);
    this._depth = 0;
  }

  private _onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    this._depth++;
    this._setDragging(true);
  };

  private _onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    this._setDragging(true);
  };

  /* No hasFiles guard: ``dataTransfer`` can arrive null/stripped on
     leave, and ``_depth`` only ever increments for file drags — an
     early return here would leave the highlight stuck. Clearing at
     depth 0 also covers a drag that only ever fired dragover. */
  private _onDragLeave = () => {
    if (this._depth > 0) this._depth--;
    if (this._depth === 0) this._setDragging(false);
  };

  private _onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    this._depth = 0;
    this._setDragging(false);
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => {
      const name = f.name.toLowerCase();
      return this._extensions.some((ext) => name.endsWith(ext));
    });
    if (file) this._onFile(file);
  };

  /** Swallow file drags that miss the target while it's visible.
   *  ``dropEffect = "none"`` shows the not-allowed cursor and keeps
   *  the drop from firing; the drop guard is belt-and-braces. */
  private _onWindowDragOver = (e: DragEvent) => {
    if (!hasFiles(e) || e.defaultPrevented) return;
    if (!isVisible(this._target)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
  };

  private _onWindowDrop = (e: DragEvent) => {
    if (!hasFiles(e) || e.defaultPrevented) return;
    if (!isVisible(this._target)) return;
    e.preventDefault();
  };

  private _setDragging(dragging: boolean) {
    if (dragging === this.dragging) return;
    this.dragging = dragging;
    this._host.requestUpdate();
  }
}

/* ``files.length`` fallback: this also gates the window navigation
   guard, so a UA delivering a file drop without the "Files" type must
   still be caught. ``files`` stays empty for text drags. */
function hasFiles(e: DragEvent): boolean {
  if (!e.dataTransfer) return false;
  return e.dataTransfer.types.includes("Files") || e.dataTransfer.files.length > 0;
}
