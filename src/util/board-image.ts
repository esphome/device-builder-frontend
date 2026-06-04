import type { BoardCatalogEntry } from "../api/types/boards.js";
import { withBase } from "./base-path.js";

const DEFAULT_BOARD_IMAGE = "/assets/board/default.svg";

/** First catalog image for a board, or the bundled placeholder. */
export function boardImageUrl(board: BoardCatalogEntry): string {
  if (board.images.length > 0) return board.images[0];
  return withBase(DEFAULT_BOARD_IMAGE);
}

/** `@error` handler that swaps a broken board image for the placeholder. */
export function onBoardImageError(e: Event): void {
  const img = e.target as HTMLImageElement;
  const fallback = withBase(DEFAULT_BOARD_IMAGE);
  if (img.src !== window.location.origin + fallback && !img.src.endsWith(fallback)) {
    img.src = fallback;
  }
}
