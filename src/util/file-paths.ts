/**
 * Helpers for config-relative file paths (devices and package / include YAMLs).
 *
 * A YAML at the top of the config dir, or anywhere under the top-level
 * ``devices/`` folder, is a device; any other YAML in a subfolder is a
 * package. Secrets files (``secrets.yaml`` and ``secrets.<name>.yaml``) are
 * neither. The backend is authoritative; these only shape URLs and catch
 * obvious input mistakes before the round-trip.
 */

const YAML_RE = /\.ya?ml$/i;
// The trailing dots and spaces Win32 drops from a file name, as the backend does.
const TRAILING_DOTS_RE = /[. ]+$/;

/** Top-level folder whose YAMLs, at any depth, are devices (exact, lowercase). */
export const DEVICES_DIR = "devices";

function encodeSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** App-relative URL of the file editor for *path* (slashes kept literal). */
export function fileEditorUrl(path: string): string {
  return `/file/${encodeSegments(path)}`;
}

/** App-relative URL of the device editor for *configuration*; a nested
 *  device keeps its literal slashes like {@link fileEditorUrl}. */
export function deviceEditorUrl(configuration: string): string {
  return `/device/${encodeSegments(configuration)}`;
}

/** *path*'s file name the way Win32 resolves it: trailing dots and spaces
 *  gone, case folded. */
function foldedFileName(path: string): string {
  return fileNameOf(path).replace(TRAILING_DOTS_RE, "").toLowerCase();
}

/** Whether *path* names a secrets file (``secrets.yaml``, ``secrets.ci.yaml``, ...). */
export function isSecretsLikeName(path: string): boolean {
  const name = foldedFileName(path);
  return name.startsWith("secrets.") && YAML_RE.test(name);
}

/** Whether *path* is THE secrets file ``!secret`` reads (``secrets.yaml`` or
 *  ``.yml``, at any depth); ``secrets.ci.yaml`` is not. */
export function isSecretsFile(path: string): boolean {
  const name = foldedFileName(path);
  return name === "secrets.yaml" || name === "secrets.yml";
}

/** Whether every segment of *path* is non-empty and not hidden, and it ends
 *  in a YAML name: the only files the backend walks. */
function isVisibleYaml(parts: readonly string[]): boolean {
  return (
    parts.every((p) => p !== "" && !p.startsWith(".")) &&
    YAML_RE.test(parts[parts.length - 1])
  );
}

/** Whether config-relative *path* is a device: a visible YAML at the top
 *  level or under ``devices/``, and not a secrets file. Mirrors the
 *  backend's classifier. */
export function isDevicePath(path: string): boolean {
  const parts = path.split("/");
  return (
    isVisibleYaml(parts) &&
    !isSecretsLikeName(path) &&
    (parts.length === 1 || parts[0] === DEVICES_DIR)
  );
}

/** Whether *segment* is the ``devices`` folder in any case: the backend refuses
 *  package operations there, though only the exact name holds devices. */
function isDevicesFolder(segment: string): boolean {
  return segment.toLowerCase() === DEVICES_DIR;
}

/** Whether config-relative *path* is a package: a visible subfolder YAML
 *  outside ``devices/`` and ``archive/`` that is not a secrets file. */
export function isPackagePath(path: string): boolean {
  const parts = path.split("/");
  return (
    parts.length > 1 &&
    isVisibleYaml(parts) &&
    !isSecretsLikeName(path) &&
    !isDevicesFolder(parts[0]) &&
    !isArchivedPath(path)
  );
}

/** Whether any segment of *path* is hidden (starts with a dot): the backend
 *  neither walks such files nor answers usage lookups for them. */
export function isHiddenPath(path: string): boolean {
  return path.split("/").some((p) => p.startsWith("."));
}

/** Where to open config-relative *path*: the Secrets page (which edits
 *  ``secrets.yaml``) for the top-level ``secrets.yaml``, the device editor for a device, the file editor otherwise.
 *  Null for any other secrets-like file, which the file editor refuses. */
export function openTargetUrl(path: string): string | null {
  if (isSecretsLikeName(path))
    return !path.includes("/") && foldedFileName(path) === "secrets.yaml"
      ? "/secrets"
      : null;
  return isDevicePath(path) ? deviceEditorUrl(path) : fileEditorUrl(path);
}

/** Whether *path* lies in the top-level ``archive/`` folder (any case, as
 *  the backend folds it); an archived device has no editor. */
export function isArchivedPath(path: string): boolean {
  const slash = path.indexOf("/");
  return slash > 0 && path.slice(0, slash).toLowerCase() === "archive";
}

/** Folder part of *path* ("" for a top-level file). */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** File name part of *path*. */
export function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** File name of *path* without its YAML extension: the device name a
 *  configuration stands for, whatever folder it sits in. */
export function fileStemOf(path: string): string {
  return fileNameOf(path).replace(YAML_RE, "");
}

/** *configuration* renamed to *newName*, keeping its folder and its
 *  ``.yaml`` / ``.yml`` extension (``.yaml`` when it has neither). */
export function renamedConfiguration(configuration: string, newName: string): string {
  const ext = configuration.match(/\.ya?ml$/)?.[0] ?? ".yaml";
  const folder = folderOf(configuration);
  return `${folder ? `${folder}/` : ""}${newName}${ext}`;
}

/** *paths* grouped by folder; folders and files keep the input order. */
export function groupByFolder(paths: readonly string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const folder = folderOf(path);
    const bucket = groups.get(folder);
    if (bucket) bucket.push(path);
    else groups.set(folder, [path]);
  }
  return groups;
}

/** Problem with a new package path the user typed, as a translation key,
 *  or null when it looks valid. Mirrors the backend rules loosely. */
export function newPackagePathProblem(raw: string): string | null {
  const path = raw.trim();
  const parts = path.split("/");
  if (parts.length < 2 || parts.some((p) => p === ""))
    return "packages.path_needs_folder";
  if (parts.some((p) => p === ".." || p.startsWith(".")) || /[\\:]/.test(path)) {
    return "packages.path_invalid";
  }
  // Names an !include can't hold verbatim; ESPHome expands ``$var`` in its path.
  if (/[\s#"'{}[\],$]/.test(path)) return "packages.path_characters";
  // Unicode, like the backend's Python ``\w``.
  if (parts.some((p) => !/^[\p{L}\p{N}_]/u.test(p))) return "packages.path_start";
  if (!YAML_RE.test(path)) return "packages.path_needs_yaml";
  if (isSecretsLikeName(path) || parts[0].toLowerCase() === "archive") {
    return "packages.path_reserved";
  }
  if (isDevicesFolder(parts[0])) return "packages.path_in_devices";
  return null;
}
