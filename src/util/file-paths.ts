/**
 * Helpers for config-relative file paths (package / include YAMLs).
 *
 * A YAML at the top of the config dir is a device; one in a subfolder
 * is a package. The backend is authoritative; these only shape URLs and
 * catch obvious input mistakes before the round-trip.
 */

const YAML_RE = /\.ya?ml$/i;

/** App-relative URL of the file editor for *path* (slashes kept literal). */
export function fileEditorUrl(path: string): string {
  return `/file/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Where to open config-relative *path*: the device editor for a top-level
 *  YAML (the scanner's device rule), the file editor for anything deeper. */
export function openTargetUrl(path: string): string {
  return folderOf(path) === ""
    ? `/device/${encodeURIComponent(path)}`
    : fileEditorUrl(path);
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
  if (!YAML_RE.test(path)) return "packages.path_needs_yaml";
  if (
    /^secrets\.ya?ml$/i.test(fileNameOf(path)) ||
    parts[0].toLowerCase() === "archive"
  ) {
    return "packages.path_reserved";
  }
  return null;
}
