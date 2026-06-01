import { css } from "lit";

/**
 * Status-pill palette for surfaces rendering a JobStatus
 * (queued / running / completed / failed / cancelled). Mirrors
 * the backend enum names so the consumer can render
 * ``<span class="status-pill status-${job.status}">`` directly
 * off the wire value.
 *
 * Imported by remote-build-job-dialog's list view; future
 * job-status surfaces should pull in the same helper rather
 * than re-declaring the palette.
 */
export const jobStatusPillStyles = css`
  .status-pill {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink: 0;
  }

  .status-pill.status-queued,
  .status-pill.status-running {
    background: var(--esphome-tint-strong);
    color: var(--esphome-primary);
  }

  .status-pill.status-completed {
    background: color-mix(in srgb, var(--esphome-success), transparent 80%);
    color: var(--esphome-success);
  }

  .status-pill.status-failed,
  .status-pill.status-cancelled {
    background: color-mix(in srgb, var(--esphome-error), transparent 80%);
    color: var(--esphome-error);
  }
`;
