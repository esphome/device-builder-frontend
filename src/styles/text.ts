import { css } from "lit";

/** Text overflow helpers: single-line ellipsis and the 2-line clamp. */
export const textStyles = css`
  .truncate {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
`;
