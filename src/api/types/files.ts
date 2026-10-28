/** Package / include YAMLs that are not devices (``files/*`` commands). */

/** A YAML in a subfolder of the config dir; ``path`` is POSIX-relative. */
export interface PackageFile {
  path: string;
}

/** ``files/usage`` reply. ``unknown`` lists devices whose included files
 *  aren't known yet (never parsed, or the startup scan is still running). */
export interface FileUsage {
  used_by: string[];
  unknown: string[];
}

/** ``files/dependencies`` reply. Paths outside the config dir stay absolute. */
export interface DeviceDependencies {
  files: string[];
  complete: boolean;
}

/** ``files/rename`` reply. ``unresolved`` lists devices using the file whose
 *  references couldn't be rewritten (e.g. ``${substitution}``-built paths). */
export interface FileRenameResult {
  path: string;
  rewritten: string[];
  unresolved: string[];
}
