// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { BoardCatalogEntry } from "../../src/api/types/boards.js";

// Simulate a non-root deployment base (HA ingress / reverse-proxy subpath) so
// the prefixing of root-relative board images is observable.
vi.mock("../../src/util/base-path.js", () => ({
  withBase: (p: string) => (p.startsWith("/") ? `/api/hassio_ingress/tok${p}` : p),
}));

const { boardImageUrl, defaultBoardImageUrl, onBoardImageError } =
  await import("../../src/util/board-image.js");

const board = (images: string[]): BoardCatalogEntry =>
  ({ id: "b", name: "B", images }) as BoardCatalogEntry;

describe("boardImageUrl", () => {
  it("prefixes a root-relative local board image with the deployment base", () => {
    // Generic board SVGs are served from the backend at /boards/images/...;
    // under ingress they must carry the base prefix or they 404 against origin.
    expect(boardImageUrl(board(["/boards/images/_generic/bk72xx.svg"]))).toBe(
      "/api/hassio_ingress/tok/boards/images/_generic/bk72xx.svg"
    );
  });

  it("leaves an external image URL unchanged", () => {
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
