// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { BoardCatalogEntry } from "../../src/api/types/boards.js";
import {
  boardImageUrl,
  defaultBoardImageUrl,
  onBoardImageError,
} from "../../src/util/board-image.js";

const board = (images: string[]): BoardCatalogEntry =>
  ({ id: "b", name: "B", images }) as BoardCatalogEntry;

describe("boardImageUrl", () => {
  it("returns the first catalog image when present", () => {
    expect(boardImageUrl(board(["https://example.com/a.png", "b.png"]))).toBe(
      "https://example.com/a.png"
    );
  });

  it("falls back to the bundled placeholder when there are no images", () => {
    expect(boardImageUrl(board([]))).toBe(defaultBoardImageUrl());
  });
});

describe("defaultBoardImageUrl", () => {
  it("points at the bundled board placeholder asset", () => {
    expect(defaultBoardImageUrl().endsWith("/assets/board/default.svg")).toBe(true);
  });
});

describe("onBoardImageError", () => {
  it("rewrites a broken image src to the placeholder", () => {
    const img = { src: "https://example.com/missing.png" };
    onBoardImageError({ target: img } as unknown as Event);
    expect(img.src).toBe(defaultBoardImageUrl());
  });

  it("leaves the src alone when it is already the placeholder", () => {
    const img = { src: defaultBoardImageUrl() };
    onBoardImageError({ target: img } as unknown as Event);
    expect(img.src).toBe(defaultBoardImageUrl());
  });
});
