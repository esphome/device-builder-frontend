import { getActiveTourConfiguration } from "../guided-tour/tour-session.js";
import { ALL_PAGE_SIZE } from "./pagination.js";

interface TourRow {
  original: { config: string };
}

export class TourTablePageController {
  private _pendingRequest: string | null = null;

  constructor(private readonly _setPageIndex: (pageIndex: number) => void) {}

  ensureTargetPage(
    rows: readonly TourRow[],
    configuredPageSize: number,
    effectivePageSize: number,
    effectivePageIndex: number
  ): void {
    const configuration = getActiveTourConfiguration();
    if (!configuration || configuredPageSize === ALL_PAGE_SIZE) {
      this._pendingRequest = null;
      return;
    }
    const rowIndex = rows.findIndex((row) => row.original.config === configuration);
    if (rowIndex < 0) {
      this._pendingRequest = null;
      return;
    }
    const pageIndex = Math.floor(rowIndex / effectivePageSize);
    if (pageIndex === effectivePageIndex) {
      this._pendingRequest = null;
      return;
    }
    const request = `${configuration}:${pageIndex}`;
    if (this._pendingRequest === request) return;
    this._pendingRequest = request;
    queueMicrotask(() => {
      if (this._pendingRequest !== request) return;
      this._pendingRequest = null;
      if (getActiveTourConfiguration() !== configuration) return;
      this._setPageIndex(pageIndex);
    });
  }
}

export function scrollTableConfigurationIntoView(
  root: ShadowRoot | null,
  configuration: string
): void {
  const row = root?.querySelector<HTMLElement>(
    `tr[data-configuration="${CSS.escape(configuration)}"]`
  );
  row?.scrollIntoView({ behavior: "instant", block: "center" });
}
