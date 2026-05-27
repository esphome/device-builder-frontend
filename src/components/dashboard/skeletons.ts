import { html } from "lit";

export const cardSkeletonTemplate = html`
  <div class="devices-grid">
    ${Array.from(
      { length: 10 },
      () => html`
        <div class="skeleton-card" aria-hidden="true">
          <div class="skeleton-line skeleton-line--title"></div>
          <div class="skeleton-line skeleton-line--subtitle"></div>
          <div class="skeleton-line skeleton-line--actions"></div>
        </div>
      `
    )}
  </div>
`;

export const tableSkeletonTemplate = html`
  <div class="skeleton-table" aria-hidden="true">
    <div class="skeleton-table-header">
      ${Array.from(
        { length: 5 },
        () => html`<div class="skeleton-line skeleton-line--header"></div>`
      )}
    </div>
    ${Array.from(
      { length: 8 },
      () => html`
        <div class="skeleton-table-row">
          ${Array.from(
            { length: 5 },
            () => html`<div class="skeleton-line skeleton-line--cell"></div>`
          )}
        </div>
      `
    )}
  </div>
`;
