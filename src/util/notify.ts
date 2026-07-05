import toast from "sonner-js";

// sonner-js doesn't export its options type; derive it from the
// method signature so the wrappers stay in lockstep with the lib.
// Exported so callers can name the passthrough-options type
// directly instead of reaching through a wrapper's signature.
export type NotifyOptions = NonNullable<Parameters<typeof toast.error>[1]>;

/**
 * Thin wrappers over sonner's toast helpers that default
 * `richColors: true`, the house style for every user-readable
 * toast. All other sonner options pass through unchanged (an
 * explicit `richColors` in `options` still wins).
 */
export const notifyError = (message: string, options?: NotifyOptions): string | number =>
  toast.error(message, { richColors: true, ...options });

export const notifyInfo = (message: string, options?: NotifyOptions): string | number =>
  toast.info(message, { richColors: true, ...options });

export const notifySuccess = (
  message: string,
  options?: NotifyOptions
): string | number => toast.success(message, { richColors: true, ...options });

export const notifyWarning = (
  message: string,
  options?: NotifyOptions
): string | number => toast.warning(message, { richColors: true, ...options });

/** Severity-indexed dispatch for call sites that pick the level at runtime. */
export const notify = {
  error: notifyError,
  info: notifyInfo,
  success: notifySuccess,
  warning: notifyWarning,
} as const;
