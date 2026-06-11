/**
 * Persisted split ratio (left-pane width fraction) for the device
 * editor's resizable two-pane layout. Storage access is guarded so a
 * throw (private mode / sandboxed iframe / quota) falls back to the
 * default instead of breaking the editor.
 */

export const MIN_SPLIT_RATIO = 0.25;
export const MAX_SPLIT_RATIO = 0.75;
export const DEFAULT_SPLIT_RATIO = 0.5;

/** Step applied per Arrow keypress when the divider has focus. */
export const SPLIT_KEY_STEP = 0.02;

const STORAGE_KEY = "esphome-editor-split-ratio";

/** Clamp an arbitrary ratio into the allowed band. */
export const clampSplitRatio = (ratio: number): number =>
  Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));

/** Read the stored ratio, falling back to the default. */
export const loadSplitRatio = (): number => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw === null ? NaN : Number.parseFloat(raw);
    return Number.isFinite(parsed) ? clampSplitRatio(parsed) : DEFAULT_SPLIT_RATIO;
  } catch {
    return DEFAULT_SPLIT_RATIO;
  }
};

/** Persist the ratio; drops the write if storage is unavailable. */
export const saveSplitRatio = (ratio: number): void => {
  try {
    localStorage.setItem(STORAGE_KEY, String(ratio));
  } catch {
    // Drop the write so resizing still completes.
  }
};

/**
 * Map a divider keydown to the next ratio, or null for non-resize keys.
 * Arrow nudges one step, Home/End jump to the band ends; always clamped.
 */
export const nextSplitRatioForKey = (current: number, key: string): number | null => {
  let next: number;
  if (key === "ArrowLeft") next = current - SPLIT_KEY_STEP;
  else if (key === "ArrowRight") next = current + SPLIT_KEY_STEP;
  else if (key === "Home") next = MIN_SPLIT_RATIO;
  else if (key === "End") next = MAX_SPLIT_RATIO;
  else return null;
  return clampSplitRatio(next);
};
